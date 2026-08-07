import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sanitizeFix } from "@road-crew/core";
import type { Fix } from "./geolocation-types.ts";
import { addBreadcrumb } from "@/monitoring";

// Battery-safe geolocation, matching legacy app/js/gps.js:
//   - the last good fix is persisted so the next mount can render immediately
//     instead of showing "Acquiring GPS…" again;
//   - incoming fixes are sanitized (bad lat/lng from the browser are dropped
//     rather than poisoning distance math or the persisted cache);
//   - emits are throttled to at most once per second via rAF, coalescing
//     rapid-fire updates;
//   - the watch pauses while the tab is hidden and resumes in the foreground.
const STORAGE_KEY = "rc.gps.lastFix";
const MIN_UPDATE_INTERVAL_MS = 1000;

/**
 * Web geolocation via navigator.geolocation.watchPosition. Calling this mounts a
 * live watch (which triggers the browser's permission prompt).
 */
export function useGeolocation(): {
  fix: Fix | null;
  error: string | null;
  requestFix: () => Promise<Fix | null>;
} {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastEmitRef = useRef(0);
  const pendingRef = useRef<Fix | null>(null);
  const rafScheduledRef = useRef(false);
  const requestFixRef = useRef<() => Promise<Fix | null>>(async () => null);

  // Cold-start: hydrate from the last persisted fix so the GPS panel/status
  // sheet has something to show before the first live update arrives.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const cached = sanitizeFix(JSON.parse(raw) as Record<string, unknown>);
        if (cached) {
          setFix((current) => (
            current && current.ts > cached.ts ? current : cached
          ));
        }
      })
      .catch(() => {
        /* corrupt/unavailable cache — fall through to live GPS only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocation is not available.");
      return;
    }

    const flush = () => {
      rafScheduledRef.current = false;
      if (!pendingRef.current) return;
      const next = pendingRef.current;
      pendingRef.current = null;
      lastEmitRef.current = Date.now();
      setFix((current) => (
        current && current.ts > next.ts ? current : next
      ));
    };

    const scheduleEmit = () => {
      const elapsed = Date.now() - lastEmitRef.current;
      if (elapsed >= MIN_UPDATE_INTERVAL_MS) {
        if (!rafScheduledRef.current) {
          rafScheduledRef.current = true;
          requestAnimationFrame(flush);
        }
      } else {
        setTimeout(() => {
          if (!rafScheduledRef.current && pendingRef.current) {
            rafScheduledRef.current = true;
            requestAnimationFrame(flush);
          }
        }, MIN_UPDATE_INTERVAL_MS - elapsed);
      }
    };

    let watchId: number | null = null;

    const onSuccess = (p: GeolocationPosition) => {
      const sanitized = sanitizeFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        speed: p.coords.speed,
        heading: p.coords.heading,
        ts: p.timestamp,
      });
      // The browser occasionally hands back a fix with NaN/missing coords;
      // ignore it rather than poisoning distance math or the persisted cache.
      if (!sanitized) return;
      setError(null);
      pendingRef.current = sanitized;
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized)).catch(() => {});
      scheduleEmit();
    };
    const onFailure = (e: GeolocationPositionError) => {
      setError(e.message || "Location error.");
      addBreadcrumb("geolocation error", { code: e.code, message: e.message });
    };

    requestFixRef.current = () => new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const sanitized = sanitizeFix({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
            ts: position.timestamp,
          });
          if (!sanitized) {
            resolve(null);
            return;
          }
          pendingRef.current = null;
          lastEmitRef.current = Date.now();
          setError(null);
          setFix((current) => (
            current && current.ts > sanitized.ts ? current : sanitized
          ));
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized)).catch(() => {});
          resolve(sanitized);
        },
        (failure) => {
          onFailure(failure);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15_000,
        },
      );
    });

    const startWatch = () => {
      if (watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(onSuccess, onFailure, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      });
    };
    const stopWatch = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };

    startWatch();
    const onVisibilityChange = () => {
      if (document.hidden) stopWatch();
      else startWatch();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      requestFixRef.current = async () => null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopWatch();
    };
  }, []);

  const requestFix = useCallback(() => requestFixRef.current(), []);
  return { fix, error, requestFix };
}
