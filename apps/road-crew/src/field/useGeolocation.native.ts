import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import { sanitizeFix } from "@road-crew/core";
import type { Fix } from "./geolocation-types.ts";
import {
  LOCATION_REFRESH_RETRY_MS,
  LOCATION_WATCHDOG_INTERVAL_MS,
  shouldRefreshLocation,
} from "./locationFreshness.ts";
import { addBreadcrumb } from "@/monitoring";

// Native geolocation via expo-location, mirroring the web hook
// (useGeolocation.web.ts): request foreground permission, watch position with
// high accuracy, sanitize incoming fixes, and pause the foreground watch while
// the app is backgrounded. Tracked vans continue reporting through the separate
// TaskManager background-location task. Requires a dev/EAS build and the
// location permission strings in app.json.
const MIN_UPDATE_INTERVAL_MS = 1_000;

export function useGeolocation(): {
  fix: Fix | null;
  error: string | null;
  requestFix: () => Promise<Fix | null>;
} {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const watchStartingRef = useRef<Promise<void> | null>(null);
  const refreshRef = useRef<Promise<Fix | null> | null>(null);
  const requestFixRef = useRef<() => Promise<Fix | null>>(async () => null);
  const lastFixTimestampRef = useRef<number | null>(null);
  const lastRefreshAttemptRef = useRef(0);
  const activeRef = useRef(AppState.currentState === "active");
  const permissionGrantedRef = useRef(false);
  const permissionDeniedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const stopWatch = () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };

    const applyPosition = (position: Location.LocationObject): Fix | null => {
      const sanitized = sanitizeFix({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed,
        heading: position.coords.heading,
        ts: position.timestamp,
      });
      if (!sanitized || cancelled || !activeRef.current) return null;
      // A newly started Core Location receiver may first emit an older cached
      // position. Never let that replace a newer fix already held by the app.
      if (
        lastFixTimestampRef.current != null
        && sanitized.ts < lastFixTimestampRef.current
      ) {
        return null;
      }
      lastFixTimestampRef.current = sanitized.ts;
      setError(null);
      setFix(sanitized);
      return sanitized;
    };

    const handleWatchError = (reason: string) => {
      addBreadcrumb("native geolocation watch error", { error: reason });
      // A radio transition (for example, airplane mode) can make the active
      // watcher fail even though the last good GPS fix remains useful. Keep that
      // fix and wait for recovery instead of surfacing a persistent generic
      // location issue.
      if (!cancelled && activeRef.current && lastFixTimestampRef.current == null) {
        setError("Waiting for GPS signal.");
      }
    };

    const startWatch = (recheckPermission = false): Promise<void> => {
      if (cancelled || !activeRef.current) return Promise.resolve();
      if (subscriptionRef.current) return Promise.resolve();
      if (watchStartingRef.current) return watchStartingRef.current;
      if (permissionDeniedRef.current && !recheckPermission) return Promise.resolve();

      const starting = (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          permissionGrantedRef.current = status === "granted";
          permissionDeniedRef.current = status !== "granted";
          if (status !== "granted") {
            if (!cancelled) setError("Location permission denied.");
            return;
          }
          if (cancelled || !activeRef.current) return;
          const subscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: MIN_UPDATE_INTERVAL_MS,
              distanceInterval: 0,
            },
            applyPosition,
            handleWatchError,
          );
          if (cancelled || !activeRef.current) {
            subscription.remove();
            return;
          }
          subscriptionRef.current = subscription;
        } catch (err) {
          addBreadcrumb("native geolocation error", {
            error: err instanceof Error ? err.message : String(err),
          });
          if (!cancelled && lastFixTimestampRef.current == null) {
            setError("Waiting for GPS signal.");
          }
        }
      })();
      watchStartingRef.current = starting;
      void starting.finally(() => {
        if (watchStartingRef.current === starting) watchStartingRef.current = null;
      });
      return starting;
    };

    const requestFreshPosition = (reason: string, force = false): Promise<Fix | null> => {
      if (!permissionGrantedRef.current) return Promise.resolve(null);
      if (refreshRef.current) return refreshRef.current;
      const now = Date.now();
      if (
        !force
        && now - lastRefreshAttemptRef.current < LOCATION_REFRESH_RETRY_MS
      ) {
        return Promise.resolve(null);
      }
      lastRefreshAttemptRef.current = now;
      const refreshing = (async () => {
        try {
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          const nextFix = applyPosition(position);
          addBreadcrumb("native geolocation refreshed", { reason });
          return nextFix;
        } catch (err) {
          addBreadcrumb("native geolocation refresh error", {
            reason,
            error: err instanceof Error ? err.message : String(err),
          });
          if (
            !cancelled
            && activeRef.current
            && lastFixTimestampRef.current == null
          ) {
            setError("Waiting for GPS signal.");
          }
          return null;
        }
      })();
      refreshRef.current = refreshing;
      void refreshing.finally(() => {
        if (refreshRef.current === refreshing) refreshRef.current = null;
      });
      return refreshing;
    };

    requestFixRef.current = async () => {
      await startWatch(true);
      return requestFreshPosition("follow-toggle", true);
    };

    const activate = async (reason: string, forceRefresh = false) => {
      await startWatch(forceRefresh);
      if (
        cancelled
        || !activeRef.current
        || !permissionGrantedRef.current
        || (!forceRefresh && !shouldRefreshLocation(lastFixTimestampRef.current))
      ) {
        return;
      }
      void requestFreshPosition(reason, forceRefresh);
    };

    void activate("launch", true);
    const watchdog = setInterval(() => {
      if (!activeRef.current) return;
      void (async () => {
        await startWatch();
        if (
          permissionGrantedRef.current
          && shouldRefreshLocation(lastFixTimestampRef.current)
        ) {
          await requestFreshPosition("watchdog");
        }
      })();
    }, LOCATION_WATCHDOG_INTERVAL_MS);

    // Pause the watch while backgrounded, resume on return (battery parity with
    // the web hook's visibilitychange handling).
    const appStateSub = AppState.addEventListener("change", (state) => {
      activeRef.current = state === "active";
      if (activeRef.current) void activate("foreground", true);
      else stopWatch();
    });

    return () => {
      cancelled = true;
      requestFixRef.current = async () => null;
      activeRef.current = false;
      clearInterval(watchdog);
      stopWatch();
      appStateSub.remove();
    };
  }, []);

  const requestFix = useCallback(() => requestFixRef.current(), []);
  return { fix, error, requestFix };
}
