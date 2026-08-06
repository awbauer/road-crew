import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import { loadSequences } from "@road-crew/data";
import type { RouteData } from "@road-crew/contracts";
import { CONFIG } from "@/config";
import { addBreadcrumb, captureError } from "@/monitoring";
import { accessFetch } from "@/api/accessFetch";
import { errorMessage, isLikelyTransientError } from "@/lib/errors";
import { onConnectivityChange } from "@/sync/network";
import { loadBundledRouteData } from "./bundledRouteData";
import {
  FOREGROUND_SETTLE_MS,
  shouldCommitForegroundResult,
} from "./foregroundLifecycle";
import { loadCachedRouteData, saveCachedRouteData } from "./routeCache";
import { routeDataRevision } from "./routeDataIdentity";

// Web is served same-origin (base ""); native needs the absolute Worker origin.
const baseUrl = Platform.OS === "web" ? "" : CONFIG.apiBaseUrl;

interface RoutesState {
  data: RouteData | null;
  error: string | null;
}

const RoutesContext = createContext<RoutesState | null>(null);

/** Loads the baked route catalog once for the entire field-app surface. */
function useRouteLoader(): RoutesState {
  const [data, setData] = useState<RouteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let refreshInFlight = false;
    let refreshPending: { reason: string; forceRefresh: boolean } | null = null;
    let pendingOfflineData: RouteData | null = null;
    let hasUsableData = false;
    let publishedRevision: string | null = null;
    const requiresForeground = Platform.OS !== "web";
    let foregroundActive = !requiresForeground || AppState.currentState === "active";
    let foregroundEpoch = 0;
    let foregroundTimer: ReturnType<typeof setTimeout> | null = null;

    const canCommit = (startedEpoch: number) => alive && shouldCommitForegroundResult(
      requiresForeground,
      foregroundActive,
      startedEpoch,
      foregroundEpoch,
    );

    const publishRouteData = (nextData: RouteData): boolean => {
      const nextRevision = routeDataRevision(nextData);
      setError(null);
      if (nextRevision === publishedRevision) return false;
      publishedRevision = nextRevision;
      setData(nextData);
      return true;
    };

    const refreshRoutes = async (reason: string, forceRefresh = false) => {
      if (!foregroundActive) return;
      if (refreshInFlight) {
        refreshPending = { reason, forceRefresh };
        return;
      }
      refreshInFlight = true;
      const startedEpoch = foregroundEpoch;
      try {
        const fresh = await loadSequences({
          baseUrl,
          fetchImpl: accessFetch,
          forceRefresh,
        });
        await saveCachedRouteData(fresh);
        hasUsableData = true;
        if (canCommit(startedEpoch)) {
          const uiChanged = publishRouteData(fresh);
          addBreadcrumb("route data refreshed", {
            reason,
            routeCount: fresh.routes.length,
            uiChanged,
          });
        } else if (alive) {
          addBreadcrumb("route data UI commit suppressed", {
            reason,
            startedEpoch,
            currentEpoch: foregroundEpoch,
            appActive: foregroundActive,
          });
        }
      } catch (e) {
        if (canCommit(startedEpoch) && !hasUsableData) {
          setError(e instanceof Error ? e.message : String(e));
        }
        if (isLikelyTransientError(e)) {
          addBreadcrumb("route refresh deferred", {
            reason,
            error: errorMessage(e),
            usedOfflineRouteData: hasUsableData,
          });
        } else {
          captureError(e, {
            tags: { source: "loadSequences" },
            extra: { baseUrl, reason, usedOfflineRouteData: hasUsableData },
          });
        }
      } finally {
        refreshInFlight = false;
        const pending = refreshPending;
        refreshPending = null;
        if (pending && foregroundActive && alive) {
          void refreshRoutes(pending.reason, pending.forceRefresh);
        }
      }
    };

    const scheduleForegroundRefresh = () => {
      if (foregroundTimer) clearTimeout(foregroundTimer);
      const scheduledEpoch = foregroundEpoch;
      foregroundTimer = setTimeout(() => {
        foregroundTimer = null;
        if (!alive || !foregroundActive || scheduledEpoch !== foregroundEpoch) return;
        if (pendingOfflineData) {
          publishRouteData(pendingOfflineData);
          pendingOfflineData = null;
        }
        void refreshRoutes("foreground", true);
      }, FOREGROUND_SETTLE_MS);
    };

    async function hydrateRoutes() {
      const startedEpoch = foregroundEpoch;
      // Native includes the canonical catalog so a first launch works without
      // ever reaching the API. A newer validated cache wins when available.
      const cached = await loadCachedRouteData();
      const bundled = loadBundledRouteData();
      const offlineData = cached ?? bundled;
      if (offlineData) {
        hasUsableData = true;
        if (canCommit(startedEpoch)) {
          publishRouteData(offlineData);
        } else {
          pendingOfflineData = offlineData;
          if (foregroundActive) scheduleForegroundRefresh();
        }
      }

      await refreshRoutes("launch");
    }

    void hydrateRoutes();

    let connectivityInitialized = false;
    const netUnsub = onConnectivityChange((online) => {
      if (!connectivityInitialized) {
        connectivityInitialized = true;
        return;
      }
      if (online) void refreshRoutes("reconnect", true);
    });
    const appStateSub = AppState.addEventListener("change", (state) => {
      foregroundEpoch += 1;
      foregroundActive = state === "active";
      if (foregroundTimer) {
        clearTimeout(foregroundTimer);
        foregroundTimer = null;
      }
      if (foregroundActive) scheduleForegroundRefresh();
    });

    return () => {
      alive = false;
      if (foregroundTimer) clearTimeout(foregroundTimer);
      netUnsub();
      appStateSub.remove();
    };
  }, []);

  return useMemo(() => ({ data, error }), [data, error]);
}

export function RoutesProvider({ children }: { children: ReactNode }) {
  const value = useRouteLoader();
  return createElement(RoutesContext.Provider, { value }, children);
}

/** Reads the single route catalog owned by the field layout. */
export function useRoutes(): RoutesState {
  const value = useContext(RoutesContext);
  if (!value) throw new Error("useRoutes must be used within RoutesProvider");
  return value;
}
