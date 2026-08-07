/** Delay heavy native-map work until the foreground transition has settled. */
export const FOREGROUND_SETTLE_MS = 300;

/**
 * A response may only update native UI when it was started and completed in
 * the same foreground epoch. This rejects work that crosses a background or
 * inactive transition, including a fast background/foreground round trip.
 */
export function shouldCommitForegroundResult(
  requiresForeground: boolean,
  active: boolean,
  startedEpoch: number,
  currentEpoch: number,
): boolean {
  return !requiresForeground || (active && startedEpoch === currentEpoch);
}
