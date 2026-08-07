import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * A foreground-aware device clock for UI derived from server timestamps.
 *
 * Network refreshes replace the timestamp; this clock advances the displayed
 * age even when no refresh can complete. Returning to the foreground updates
 * immediately instead of waiting for the next interval.
 */
export function useNow(active = true, intervalMs = 1_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    let foreground = AppState.currentState === "active";
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = setInterval(() => {
      if (foreground) tick();
    }, intervalMs);
    const subscription = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (foreground) tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [active, intervalMs]);

  return nowMs;
}
