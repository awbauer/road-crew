import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { activateKeepAwakeAsync, addListener, deactivateKeepAwake } from "expo-keep-awake";
import { addBreadcrumb, captureError } from "@/monitoring";

const TAG = "rc-follow";
const RETRY_DELAY_MS = 250;

function isVisible(): boolean {
  if (AppState.currentState !== "active") return false;
  if (Platform.OS !== "web") return true;
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function isExpectedWakeLockFailure(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotAllowedError" || name === "NotSupportedError" || name === "SecurityError";
}

/**
 * Keeps the screen awake for as long as `enabled` is true (native + web via
 * expo-keep-awake, which wraps the Wake Lock API on web).
 */
export function useKeepAwakeWhen(enabled: boolean): void {
  const enabledRef = useRef(enabled);
  const requestInFlightRef = useRef(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    let mounted = true;

    const clearRetry = () => {
      if (!retryRef.current) return;
      clearTimeout(retryRef.current);
      retryRef.current = null;
    };

    const release = () => {
      clearRetry();
      deactivateKeepAwake(TAG).catch(() => {
        /* best effort */
      });
    };

    const activate = (reason: string) => {
      if (!mounted || !enabledRef.current || !isVisible() || requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      activateKeepAwakeAsync(TAG)
        .then(() => {
          if (!mounted || !enabledRef.current) {
            deactivateKeepAwake(TAG).catch(() => {
              /* best effort */
            });
            return;
          }
          addBreadcrumb("screen wake lock active", { reason, platform: Platform.OS });
        })
        .catch((error) => {
          if (!mounted || !enabledRef.current) return;
          const context = { source: "keep_awake_activate", reason, platform: Platform.OS };
          if (isExpectedWakeLockFailure(error)) {
            addBreadcrumb("screen wake lock unavailable", context);
            return;
          }
          captureError(error, { tags: { source: "keep_awake_activate" }, extra: context });
        })
        .finally(() => {
          requestInFlightRef.current = false;
        });
    };

    const scheduleActivate = (reason: string) => {
      if (!mounted || !enabledRef.current || !isVisible()) return;
      clearRetry();
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        activate(reason);
      }, RETRY_DELAY_MS);
    };

    const handleAppStateChange = () => {
      if (isVisible()) {
        scheduleActivate("app_active");
      } else {
        release();
      }
    };
    const handleGesture = () => activate("gesture");
    const handleFocus = () => scheduleActivate("focus");

    if (!enabled) {
      release();
      return () => {
        mounted = false;
        clearRetry();
      };
    }

    activate("enabled");
    const appStateSubscription = AppState.addEventListener("change", handleAppStateChange);
    const keepAwakeSubscription = (() => {
      try {
        return addListener(TAG, (event) => {
          if (event.state === "release") scheduleActivate("released");
        });
      } catch {
        return null;
      }
    })();

    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleAppStateChange);
      document.addEventListener("pointerdown", handleGesture, { passive: true });
    }
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
    }

    return () => {
      mounted = false;
      clearRetry();
      appStateSubscription.remove();
      keepAwakeSubscription?.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleAppStateChange);
        document.removeEventListener("pointerdown", handleGesture);
      }
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus);
      }
      release();
    };
  }, [enabled]);
}
