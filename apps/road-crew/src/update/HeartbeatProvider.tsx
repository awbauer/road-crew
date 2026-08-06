import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { router } from "expo-router";
import type { HeartbeatLocationBody, NotificationItem } from "@road-crew/contracts";
import { sendHeartbeat } from "@/api/heartbeat";
import { CONFIG } from "@/config";
import { useSession } from "@/auth/SessionProvider";
import { getDeviceId } from "@/device/deviceId";
import { useSharedGeolocation } from "@/field/Geolocation";
import { applyBackgroundLocationPolicy } from "@/field/backgroundLocation";
import { isFixReportable, shouldAttachHeartbeatLocation } from "@/field/locationReporter.js";
import { resolveHeartbeatTrackingState } from "@/field/trackingPolicy";
import { jitter } from "@road-crew/core";
import { errorMessage } from "@/lib/errors";
import { addBreadcrumb, captureError, logError, logInfo, metricCount, metricGauge } from "@/monitoring";
import { isOnline, onConnectivityChange } from "@/sync/network";
import { getLastHeartbeatAt } from "@/update/lastHeartbeat";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_MIN_GAP_MS = 25_000;
/**
 * Floor for forced heartbeats. Launch, foreground and reconnect all skip the
 * 25s gap on purpose — Command should see a check-in the moment a driver opens
 * the app — but `inFlight` only stops calls that overlap, so anything that
 * re-fires those triggers during startup got a heartbeat each time. Real logs
 * show ten within four seconds on every launch, over half of all heartbeat
 * traffic. A forced heartbeat this close behind another one tells Command
 * nothing the last one didn't.
 */
const HEARTBEAT_FORCE_MIN_GAP_MS = 3_000;
// Reconnects arrive in correlated bursts, so the forced reconnect heartbeat is
// spread across this window (full 0-2x jitter) instead of firing immediately.
const RECONNECT_SPREAD_MS = 2_000;

export type LocationReportStatus = "idle" | "ok" | "failed";

interface HeartbeatContextValue {
  notifications: NotificationItem[];
  notificationRevision: number;
  reporting: boolean;
  reportStatus: LocationReportStatus;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastHeartbeatAt: number | null;
  lastError: string | null;
  /**
   * Driver-initiated tracking change. Persists locally, then asserts the new
   * value to the server on the next heartbeat so Command sees it. Command can
   * still change it back afterwards, and vice versa.
   */
  setTrackingEnabled: (enabled: boolean) => Promise<void>;
}

interface LocationReporterValue {
  reporting: boolean;
  reportStatus: LocationReportStatus;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastHeartbeatAt: number | null;
  lastError: string | null;
}

const HeartbeatContext = createContext<HeartbeatContextValue | null>(null);

export function HeartbeatProvider({ children }: { children: ReactNode }) {
  const {
    reportingVan,
    vanId,
    routeId,
    vanInstall,
    remoteTrackingEnabled,
    locationTrackingAllowed,
    setLocationTrackingPolicy,
    setRemoteTrackingEnabled,
    signOut,
    selectRoute,
  } = useSession();
  const { fix, requestFix } = useSharedGeolocation();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationRevision, setNotificationRevision] = useState(0);
  const [reportStatus, setReportStatus] = useState<LocationReportStatus>("idle");
  const [lastAttemptAt, setLastAttemptAt] = useState<number | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const lastCheckedAt = useRef(0);
  const inFlight = useRef(false);
  const adminActionAck = useRef<string | null>(null);
  const reporting = Boolean(reportingVan && vanId);
  const reportingRef = useRef(reporting);
  const routeIdRef = useRef(routeId);
  const vanIdRef = useRef(vanId);
  const vanInstallRef = useRef(vanInstall);
  const remoteTrackingEnabledRef = useRef(remoteTrackingEnabled);
  const locationTrackingAllowedRef = useRef(locationTrackingAllowed);
  const setLocationTrackingPolicyRef = useRef(setLocationTrackingPolicy);
  const setRemoteTrackingEnabledRef = useRef(setRemoteTrackingEnabled);
  const signOutRef = useRef(signOut);
  const selectRouteRef = useRef(selectRoute);
  const fixRef = useRef(fix);
  const requestFixRef = useRef(requestFix);
  reportingRef.current = reporting;
  routeIdRef.current = routeId;
  vanIdRef.current = vanId;
  vanInstallRef.current = vanInstall;
  remoteTrackingEnabledRef.current = remoteTrackingEnabled;
  locationTrackingAllowedRef.current = locationTrackingAllowed;
  setLocationTrackingPolicyRef.current = setLocationTrackingPolicy;
  setRemoteTrackingEnabledRef.current = setRemoteTrackingEnabled;
  signOutRef.current = signOut;
  selectRouteRef.current = selectRoute;
  fixRef.current = fix;
  requestFixRef.current = requestFix;

  useEffect(() => {
    // "Tracked" governs the native background task only. A reporting van still
    // attaches its current fix to foreground heartbeats while untracked, so its
    // foreground report status remains meaningful.
    if (CONFIG.vanInstallEnabled && reporting) return;
    setReportStatus("idle");
    setLastAttemptAt(null);
    setLastSuccessAt(null);
    setLastError(null);
  }, [reporting]);

  useEffect(() => {
    if (!CONFIG.vanInstallEnabled) return undefined;
    let cancelled = false;

    const check = async (reason: string, force = false, fixOverride: typeof fix | null = null) => {
      const now = Date.now();
      if (inFlight.current) return;
      if (now - lastCheckedAt.current < (force ? HEARTBEAT_FORCE_MIN_GAP_MS : HEARTBEAT_MIN_GAP_MS)) return;
      lastCheckedAt.current = now;
      let location: HeartbeatLocationBody | null = null;
      inFlight.current = true;
      try {
        const online = await isOnline();
        if (!online) {
          if (!cancelled && reportingRef.current) {
            setReportStatus("failed");
            setLastError("Offline");
          }
          return;
        }

        const currentVanId = vanIdRef.current;
        const currentFix = fixOverride ?? fixRef.current;
        if (
          currentFix
          && shouldAttachHeartbeatLocation({ vanInstall: vanInstallRef.current, hasFix: true, online })
          && isFixReportable(currentFix)
        ) {
          if (!cancelled) setLastAttemptAt(Date.now());
          location = {
            vanId: currentVanId || null,
            deviceId: await getDeviceId(),
            lat: currentFix.lat,
            lng: currentFix.lng,
            ts: currentFix.ts,
            accuracy: currentFix.accuracy,
            heading: currentFix.heading,
            speed: currentFix.speed,
          };
        }

        const heartbeat = await sendHeartbeat({
          location,
          // Personal installs still send the shared heartbeat, but never make
          // a Crew Van claim that would be persisted in the device store.
          vanId: reportingRef.current ? currentVanId : null,
          routeId: reportingRef.current ? routeIdRef.current : null,
          vanInstall: vanInstallRef.current,
          // Always report the device's applied value: this is observed state,
          // and it is how Command resolves a queued tracking change.
          trackingEnabled: locationTrackingAllowedRef.current && remoteTrackingEnabledRef.current,
          adminActionAck: adminActionAck.current,
          // Which trigger produced this heartbeat. Already tracked locally for
          // breadcrumbs; sending it makes a burst attributable from the Worker
          // logs alone, without a device in hand.
          heartbeatReason: reason,
        });
        if (!cancelled) {
          setLastHeartbeatAt(
            Number.isFinite(heartbeat.serverNow) && Number(heartbeat.serverNow) > 0
              ? Number(heartbeat.serverNow)
              : Date.now(),
          );
        }
        await applyBackgroundLocationPolicy(
          heartbeat.backgroundLocationPolicy?.pausesUpdatesAutomatically,
        );
        const serverAllowsTracking = heartbeat.locationTrackingPolicy?.enabled;
        const commandedTrackingEnabled = heartbeat.trackingCommand?.value;
        const resolvedTracking = resolveHeartbeatTrackingState({
          currentAllowed: locationTrackingAllowedRef.current,
          currentTrackingEnabled: remoteTrackingEnabledRef.current,
          serverAllowsTracking,
          commandedTrackingEnabled,
        });
        if (
          typeof serverAllowsTracking === "boolean"
          || typeof commandedTrackingEnabled === "boolean"
        ) {
          locationTrackingAllowedRef.current = resolvedTracking.locationTrackingAllowed;
          remoteTrackingEnabledRef.current = resolvedTracking.remoteTrackingEnabled;
          await setLocationTrackingPolicyRef.current(
            resolvedTracking.locationTrackingAllowed,
            resolvedTracking.remoteTrackingEnabled,
          );
        }
        if (!cancelled) {
          setNotifications(Array.isArray(heartbeat.notifications) ? heartbeat.notifications : []);
          setNotificationRevision((value) => value + 1);
          if (location) {
            if (heartbeat.locationReport?.ok) {
              setReportStatus("ok");
              setLastSuccessAt(Date.now());
              setLastError(null);
            } else {
              setReportStatus("failed");
              setLastError(heartbeat.locationReport?.error || "Location report was rejected.");
            }
          }
        }
        if (heartbeat.adminAction && heartbeat.adminAction.id !== adminActionAck.current) {
          const action = heartbeat.adminAction;
          if (action.type === "reset-van") {
            await signOutRef.current();
            router.replace("/");
          } else if (action.type === "set-route") {
            if (!action.routeId) throw new Error("Route change command did not include a route.");
            await selectRouteRef.current(action.routeId);
          }
          adminActionAck.current = action.id;
          addBreadcrumb("admin device action applied", {
            actionId: action.id,
            actionType: action.type,
            routeId: action.routeId ?? null,
          });
          const acknowledgement = await sendHeartbeat({
            location: null,
            vanId: action.type === "set-route" && reportingRef.current ? vanIdRef.current : null,
            routeId: action.type === "set-route" ? action.routeId : null,
            vanInstall: vanInstallRef.current,
            adminActionAck: action.id,
            heartbeatReason: "admin-action-ack",
          });
          if (!acknowledgement?.adminAction) adminActionAck.current = null;
        } else if (adminActionAck.current && !heartbeat.adminAction) {
          adminActionAck.current = null;
        }
        addBreadcrumb("app heartbeat ok", {
          reason,
          status: heartbeat.status ?? null,
          reportedLocation: Boolean(location),
          locationOk: heartbeat.locationReport?.ok ?? null,
          locationTrackingAllowed: resolvedTracking.locationTrackingAllowed,
        });
      } catch (error) {
        addBreadcrumb("app heartbeat failed", { reason, error: errorMessage(error) });
        if (!cancelled) {
          if (location) {
            setReportStatus("failed");
            setLastError(errorMessage(error));
          }
          captureError(error, { tags: { source: "app_heartbeat" }, extra: { reason } });
        }
      } finally {
        inFlight.current = false;
      }
    };

    void check("launch", true);
    // Self-rescheduling rather than setInterval so the delay is re-jittered
    // every tick; a fixed interval would keep devices that launched together
    // heartbeating in lockstep against a single-threaded Durable Object.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        if (Platform.OS === "web") {
          if (typeof document === "undefined" || !document.hidden) void check("interval");
        } else if (AppState.currentState === "active") {
          void check("interval");
        }
        scheduleNext();
      }, jitter(HEARTBEAT_INTERVAL_MS));
    };
    scheduleNext();
    const appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
      // Force a heartbeat on every foreground, bypassing the min-gap throttle,
      // so Command sees the device check in each time the app is reopened.
      if (state === "active") void check("focus", true);
    });
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const netUnsub = onConnectivityChange((online) => {
      if (online) {
        // Airplane-mode recovery can leave the watcher with an old fix. Ask the
        // platform for a fresh position before the forced reconnect heartbeat.
        setReportStatus("idle");
        setLastError(null);
        // Connectivity returning is correlated across a fleet — a cell site
        // recovering reconnects every van in its footprint at once — and this
        // heartbeat is forced past the min-gap throttle. Spread the retry so
        // the recovery itself does not become the spike.
        reconnectTimer = setTimeout(() => {
          void requestFixRef.current().then((freshFix) => check("reconnect", true, freshFix));
        }, jitter(RECONNECT_SPREAD_MS, 1));
      }
      else if (!cancelled && reportingRef.current) {
        setReportStatus("failed");
        setLastError("Offline");
      }
    });
    let onVisibility: (() => void) | null = null;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      onVisibility = () => {
        if (!document.hidden) void check("visibility");
      };
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      appStateSub.remove();
      netUnsub();
      if (onVisibility && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [reporting]);

  useEffect(() => {
    let active = true;
    void getLastHeartbeatAt().then((at) => {
      if (active && at != null) setLastHeartbeatAt(at);
    });
    return () => {
      active = false;
    };
  }, []);

  const setTrackingEnabled = useCallback(async (enabled: boolean) => {
    const applied = locationTrackingAllowedRef.current && enabled;
    remoteTrackingEnabledRef.current = applied;
    try {
      await setRemoteTrackingEnabledRef.current(applied);
      metricCount("road_crew.tracking_toggle", 1, {
        enabled: String(applied),
        outcome: "success",
      });
      metricGauge("road_crew.tracking_enabled", applied ? 1 : 0, { source: "driver" });
      logInfo("Tracking setting changed", { enabled: String(applied), source: "driver" });
    } catch (error) {
      metricCount("road_crew.tracking_toggle", 1, {
        enabled: String(applied),
        outcome: "error",
      });
      logError("Tracking setting change failed", { enabled: String(applied), source: "driver" });
      throw error;
    }
  }, []);

  const value = useMemo<HeartbeatContextValue>(() => ({
    notifications,
    notificationRevision,
    reporting,
    reportStatus,
    lastAttemptAt,
    lastSuccessAt,
    lastHeartbeatAt,
    lastError,
    setTrackingEnabled,
  }), [
    notifications,
    notificationRevision,
    reporting,
    reportStatus,
    lastAttemptAt,
    lastSuccessAt,
    lastHeartbeatAt,
    lastError,
    setTrackingEnabled,
  ]);

  return <HeartbeatContext.Provider value={value}>{children}</HeartbeatContext.Provider>;
}

export function useHeartbeat(): HeartbeatContextValue {
  const value = useContext(HeartbeatContext);
  if (!value) throw new Error("useHeartbeat must be used within a HeartbeatProvider.");
  return value;
}

export function useLocationReporter(): LocationReporterValue {
  const heartbeat = useHeartbeat();
  return {
    reporting: heartbeat.reporting,
    reportStatus: heartbeat.reportStatus,
    lastAttemptAt: heartbeat.lastAttemptAt,
    lastSuccessAt: heartbeat.lastSuccessAt,
    lastHeartbeatAt: heartbeat.lastHeartbeatAt,
    lastError: heartbeat.lastError,
  };
}
