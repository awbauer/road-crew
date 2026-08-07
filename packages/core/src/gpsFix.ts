// Ported from app/js/gps.js sanitizeFix — behavior is intentionally unchanged.

/** A trusted GPS fix. Everything downstream (distance math, nearest-sequence
 * pair, status pill) assumes lat/lng are finite and in range. */
export interface SanitizedFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  ts: number;
}

export interface RawFix {
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  speed?: unknown;
  heading?: unknown;
  ts?: unknown;
}

/**
 * Normalizes an incoming fix (from the browser/native location API, or from
 * persisted storage) into a trusted shape, or returns null if it can't be
 * trusted. accuracy/speed/heading are coerced to finite-or-null so the browser
 * convention of `null` meaning "unavailable" isn't masqueraded as `0` by
 * `Number(null) === 0`; ts falls back to `Date.now()` if missing/invalid.
 */
export function sanitizeFix(raw: RawFix | null | undefined): SanitizedFix | null {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const finiteOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const ts = Number(raw.ts);
  return {
    lat,
    lng,
    accuracy: finiteOrNull(raw.accuracy),
    speed: finiteOrNull(raw.speed),
    heading: finiteOrNull(raw.heading),
    ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
  };
}
