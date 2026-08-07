export const FOLLOW_PAUSE_MS = 12_000;
export const MANUAL_SCROLL_SETTLE_MS = 300;

export function isFollowAutoScrollPaused(
  lastManualScrollAt: number,
  now = Date.now(),
): boolean {
  return lastManualScrollAt > 0 && now - lastManualScrollAt < FOLLOW_PAUSE_MS;
}
