import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { fetchLocations } from "@/api/locations";
import type { VanLocation } from "@road-crew/contracts";
import { jitter } from "@road-crew/core";
import { CONFIG } from "@/config";
import { addBreadcrumb } from "@/monitoring";
import { isOnline, onConnectivityChange } from "@/sync/network";
import {
  FOREGROUND_SETTLE_MS,
  shouldCommitForegroundResult,
} from "./foregroundLifecycle";

// Match the reporter cadence + the location age buckets.
const FLEET_POLL_INTERVAL_MS = 30_000;

/**
 * Polls `GET /api/locations` every 30s while `enabled` (typically the Map tab's
 * focus flag), returning the latest fleet positions. Everyone sees the fleet —
 * it does not depend on this device reporting. Fetch failures degrade silently
 * and keep the last-known list until the next successful poll.
 */
export function useFleet(enabled: boolean): VanLocation[] {
  const [locations, setLocations] = useState<VanLocation[]>([]);

  useEffect(() => {
    if (!enabled || !CONFIG.vanInstallEnabled) return;
    let cancelled = false;
    let inFlight = false;
    let pollPending = false;
    const requiresForeground = Platform.OS !== "web";
    let foregroundActive = !requiresForeground || AppState.currentState === "active";
    let foregroundEpoch = 0;
    let foregroundTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!foregroundActive) return;
      if (inFlight) {
        pollPending = true;
        return;
      }
      pollPending = false;
      inFlight = true;
      const startedEpoch = foregroundEpoch;
      try {
        if (!(await isOnline()) || !foregroundActive) return;
        const next = await fetchLocations();
        if (
          !cancelled
          && shouldCommitForegroundResult(
            requiresForeground,
            foregroundActive,
            startedEpoch,
            foregroundEpoch,
          )
        ) {
          setLocations(next);
        } else if (!cancelled) {
          addBreadcrumb("fleet UI commit suppressed", {
            startedEpoch,
            currentEpoch: foregroundEpoch,
            appActive: foregroundActive,
          });
        }
      } catch (error) {
        addBreadcrumb("fleet poll failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Keep the last-known fleet; retry next tick.
      } finally {
        inFlight = false;
        if (pollPending && foregroundActive && !cancelled) {
          pollPending = false;
          void poll();
        }
      }
    };

    void poll();
    // Self-rescheduling rather than setInterval so the delay is re-jittered
    // every tick; a fixed interval would keep devices that launched together
    // polling in lockstep forever.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        if (Platform.OS === "web") {
          if (typeof document === "undefined" || !document.hidden) void poll();
        } else if (foregroundActive) {
          void poll();
        }
        scheduleNext();
      }, jitter(FLEET_POLL_INTERVAL_MS));
    };
    scheduleNext();

    const appStateSub = AppState.addEventListener("change", (state) => {
      foregroundEpoch += 1;
      foregroundActive = state === "active";
      if (!foregroundActive) pollPending = false;
      if (foregroundTimer) {
        clearTimeout(foregroundTimer);
        foregroundTimer = null;
      }
      if (foregroundActive) {
        foregroundTimer = setTimeout(() => {
          foregroundTimer = null;
          void poll();
        }, FOREGROUND_SETTLE_MS);
      }
    });
    let connectivityInitialized = false;
    const netUnsub = onConnectivityChange((online) => {
      if (!connectivityInitialized) {
        connectivityInitialized = true;
        return;
      }
      if (online && foregroundActive) void poll();
    });

    let onVisibility: (() => void) | null = null;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      onVisibility = () => {
        if (!document.hidden) void poll();
      };
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (foregroundTimer) clearTimeout(foregroundTimer);
      appStateSub.remove();
      netUnsub();
      if (onVisibility && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled]);

  return locations;
}
