import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type ArchivedNotification,
  type CenterNotification,
  type SanitizedNotification,
  pruneArchive,
  pruneSeen,
  reconcileArchive,
  selectForCenter,
  selectVisible,
  sortForCenter,
  upsertArchive,
  unreadCount as computeUnreadCount,
} from "@road-crew/core";
import { useSelectedRoute } from "@/field/RouteSelection";
import { useHeartbeat } from "@/update/HeartbeatProvider";
import { captureError } from "@/monitoring";
import { useTabletRouteWorkspace } from "@/field/useTabletRouteWorkspace";
import { APP_VERSION } from "@road-crew/config";
import { consumePendingUpdatedNotification } from "@/update/updatedToastState";
import { retainRecentUpdateNotifications } from "./archivePolicy";
import { useNow } from "@/ui/useNow";

// Consume each heartbeat notification
// snapshot, keep a reviewable archive (read/unread, pinned, expiry) for the
// bell badge + Notification Center popover, AND surface newly-arrived items
// as transient banners (info severity) or a blocking notice (high severity).
const ARCHIVE_KEY = "rc.notifications.archive";
const SEEN_KEY = "rc.notifications.seen";
const MAX_BANNERS = 3;

function isCompletedLocalUpdate(notification: ArchivedNotification): boolean {
  return notification.type === "app-update"
    && notification.source === "local"
    && notification.id.startsWith("local-update:applied:");
}

interface GoToSequenceRequest {
  routeId: string | null;
  seq: number;
}

interface NotificationsContextValue {
  items: CenterNotification[];
  unreadCount: number;
  sheetVisible: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  runAction: (n: SanitizedNotification) => void;
  pendingGoTo: GoToSequenceRequest | null;
  consumePendingGoTo: () => void;
  bannerQueue: SanitizedNotification[];
  dismissBanner: (id: string) => void;
  highSeverityNotice: SanitizedNotification | null;
  dismissHighSeverityNotice: () => void;
  ready: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best effort */
  }
}

async function markSeenNow(id: string): Promise<void> {
  const seen = await loadJSON<Record<string, number>>(SEEN_KEY, {});
  seen[id] = Date.now();
  await saveJSON(SEEN_KEY, seen);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const nowMs = useNow(true, 1_000);
  const useRouteWorkspace = useTabletRouteWorkspace();
  const { routeId } = useSelectedRoute();
  const { notifications, notificationRevision } = useHeartbeat();
  const [archive, setArchive] = useState<Record<string, ArchivedNotification>>({});
  const [sheetVisible, setSheetVisible] = useState(false);
  const [pendingGoTo, setPendingGoTo] = useState<GoToSequenceRequest | null>(null);
  const [bannerQueue, setBannerQueue] = useState<SanitizedNotification[]>([]);
  const [highSeverityQueue, setHighSeverityQueue] = useState<SanitizedNotification[]>([]);
  const [ready, setReady] = useState(false);
  const routeIdRef = useRef(routeId);
  const archiveRef = useRef<Record<string, ArchivedNotification>>({});
  routeIdRef.current = routeId;

  const persistArchive = useCallback((next: Record<string, ArchivedNotification>) => {
    archiveRef.current = next;
    saveJSON(ARCHIVE_KEY, next);
  }, []);

  useEffect(() => {
    loadJSON<Record<string, ArchivedNotification>>(ARCHIVE_KEY, {}).then((loaded) => {
      // Remove availability prompts created before automatic updates. Keep the
      // local, post-reload confirmation in the bell history.
      const localOnly = Object.fromEntries(
        Object.entries(loaded).filter(([, notification]) => (
          notification.type !== "app-update" || isCompletedLocalUpdate(notification)
        )),
      );
      const retained = retainRecentUpdateNotifications(localOnly);
      archiveRef.current = retained;
      setArchive(retained);
      if (Object.keys(retained).length !== Object.keys(loaded).length) saveJSON(ARCHIVE_KEY, retained);
      setReady(true);
    });
  }, []);

  const addLocalNotification = useCallback((notification: SanitizedNotification, showBanner = false) => {
    if (archiveRef.current[notification.id]) return;
    const nowMs = Date.now();
    const next = retainRecentUpdateNotifications(
      pruneArchive(upsertArchive(archiveRef.current, [notification], nowMs), nowMs),
    );
    persistArchive(next);
    setArchive(next);
    if (showBanner) {
      setBannerQueue((prev) => {
        if (prev.some((item) => item.id === notification.id)) return prev;
        return [...prev, notification].slice(-MAX_BANNERS);
      });
    }
  }, [persistArchive]);

  useEffect(() => {
    if (!ready) return;
    consumePendingUpdatedNotification()
      .then((pending) => {
        if (!pending) return;
        const now = new Date();
        addLocalNotification({
          id: `local-update:applied:${APP_VERSION.build}`,
          type: "app-update",
          severity: "info",
          target: { scope: "global", value: null },
          title: "App updated",
          body: `Updated to version ${APP_VERSION.release} (${APP_VERSION.build})`,
          pinned: false,
          action: null,
          createdAt: now.toISOString(),
          expiresAt: null,
          createdMs: now.getTime(),
          expiresMs: null,
          source: "local",
        });
      })
      .catch((error) => captureError(error, { tags: { source: "updated_notification" } }));
  }, [addLocalNotification, ready]);

  const applyNotifications = useCallback(async (list: unknown[]) => {
    const nowMs = Date.now();
    const currentRouteId = routeIdRef.current;
    // Update availability notices are obsolete: app updates apply immediately.
    // The only update notices retained in the bell are local confirmations
    // added after the app reloads into the new bundle.
    const nonUpdateNotifications = list.filter((raw) => !(
      raw
      && typeof raw === "object"
      && (raw as Record<string, unknown>).type === "app-update"
    ));

    const seen = await loadJSON<Record<string, number>>(SEEN_KEY, {});
    const visible = selectVisible(nonUpdateNotifications, { routeId: currentRouteId, seenIds: seen, nowMs });
    const infoVisible = visible.filter((n) => n.severity !== "high");
    const highVisible = visible.filter((n) => n.severity === "high");

    // Info banners count as acknowledged as soon as they're queued (matches
    // legacy: the banner itself is the notice). High-severity items are NOT
    // marked seen here — only when their modal is actually dismissed — so an
    // unacknowledged urgent notice keeps resurfacing across polls/reloads.
    const nextSeen = { ...seen };
    for (const n of infoVisible) nextSeen[n.id] = nowMs;
    await saveJSON(SEEN_KEY, pruneSeen(nextSeen, nonUpdateNotifications, nowMs));

    if (infoVisible.length) {
      setBannerQueue((prev) => {
        const merged = [...prev, ...infoVisible.filter((n) => !prev.some((p) => p.id === n.id))];
        return merged.slice(-MAX_BANNERS);
      });
    }
    if (highVisible.length) {
      setHighSeverityQueue((prev) => [...prev, ...highVisible.filter((n) => !prev.some((p) => p.id === n.id))]);
    }

    const targeted = selectForCenter(nonUpdateNotifications, { routeId: currentRouteId });
    setArchive((prev) => {
      let next = upsertArchive(prev, targeted, nowMs);
      next = reconcileArchive(next, nonUpdateNotifications, nowMs);
      next = pruneArchive(next, nowMs);
      persistArchive(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (notificationRevision === 0) return;
    applyNotifications(notifications).catch((error) => {
      captureError(error, { tags: { source: "notifications_sync" } });
    });
  }, [applyNotifications, notificationRevision, notifications]);

  const { items, unread } = useMemo(() => {
    const archived = Object.values(archive);
    return {
      items: sortForCenter(archived, nowMs),
      unread: computeUnreadCount(archived, nowMs),
    };
  }, [archive, nowMs]);

  const openSheet = useCallback(() => {
    setSheetVisible(true);
    setArchive((prev) => {
      const next: Record<string, ArchivedNotification> = {};
      let changed = false;
      for (const [id, n] of Object.entries(prev)) {
        if (n.read !== true) changed = true;
        next[id] = { ...n, read: true };
      }
      if (changed) persistArchive(next);
      return changed ? next : prev;
    });
  }, []);

  const closeSheet = useCallback(() => {
    setSheetVisible(false);
  }, []);

  const consumePendingGoTo = useCallback(() => {
    setPendingGoTo(null);
  }, []);

  const dismissBanner = useCallback((id: string) => {
    setBannerQueue((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const dismissHighSeverityNotice = useCallback(() => {
    setHighSeverityQueue((prev) => {
      const [current, ...rest] = prev;
      if (current) markSeenNow(current.id).catch(() => {});
      return rest;
    });
  }, []);

  const runAction = useCallback((n: SanitizedNotification) => {
    if (n.action?.kind === "go-to-sequence") {
      setPendingGoTo({ routeId: n.action.routeId, seq: n.action.seq });
      setSheetVisible(false);
      // The shared sequence workspace is what actually jumps to the sequence
      // (it owns the search/filter state); navigate there so it picks up pendingGoTo
      // even if the notification was actioned from Map, Home, a banner, or
      // the high-severity notice.
      router.push(useRouteWorkspace ? "/(field)/route" : "/(field)/sequences");
    }
    dismissBanner(n.id);
    setHighSeverityQueue((prev) => {
      if (prev[0]?.id !== n.id) return prev;
      markSeenNow(n.id).catch(() => {});
      return prev.slice(1);
    });
  }, [dismissBanner, useRouteWorkspace]);

  const value = useMemo<NotificationsContextValue>(() => ({
    items,
    unreadCount: unread,
    sheetVisible,
    openSheet,
    closeSheet,
    runAction,
    pendingGoTo,
    consumePendingGoTo,
    bannerQueue,
    dismissBanner,
    highSeverityNotice: highSeverityQueue[0] ?? null,
    dismissHighSeverityNotice,
    ready,
  }), [
    items,
    unread,
    sheetVisible,
    openSheet,
    closeSheet,
    runAction,
    pendingGoTo,
    consumePendingGoTo,
    bannerQueue,
    dismissBanner,
    highSeverityQueue,
    dismissHighSeverityNotice,
    ready,
  ]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications must be used within a NotificationsProvider.");
  return value;
}
