export const LOCATION_REFRESH_AGE_MS = 20_000;
export const LOCATION_WATCHDOG_INTERVAL_MS = 5_000;
export const LOCATION_REFRESH_RETRY_MS = 10_000;

export function shouldRefreshLocation(
  lastFixTimestamp: number | null,
  now = Date.now(),
): boolean {
  return lastFixTimestamp == null
    || !Number.isFinite(lastFixTimestamp)
    || now - lastFixTimestamp >= LOCATION_REFRESH_AGE_MS;
}
