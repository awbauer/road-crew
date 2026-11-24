// Ported from app/js/gps.js sanitizeFix, then hardened: missing coordinates
// and iOS's negative "unknown" values are rejected rather than read as 0/real.

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

export const GPS_COORDINATE_DECIMAL_PLACES = 5;
const GPS_COORDINATE_SCALE = 10 ** GPS_COORDINATE_DECIMAL_PLACES;

/** Normalize GPS coordinates to the repository-wide five-decimal contract. */
export function normalizeGpsCoordinate(value: unknown): number | null {
  const coordinate = Number(value);
  return Number.isFinite(coordinate)
    ? Math.round(coordinate * GPS_COORDINATE_SCALE) / GPS_COORDINATE_SCALE
    : null;
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
  // `Number(null)`, `Number("")` and `Number(false)` are all 0: a missing
  // coordinate must not become a fix in the Gulf of Guinea.
  const coordinate = (v: unknown): number =>
    typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : Number.NaN;
  const lat = coordinate(raw.lat);
  const lng = coordinate(raw.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const finiteOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  // iOS reports -1 for an unknown course or speed (and accuracy); none of
  // them can really be negative, so a negative value means "unavailable".
  const nonNegativeOrNull = (v: unknown): number | null => {
    const n = finiteOrNull(v);
    return n != null && n >= 0 ? n : null;
  };
  const headingOrNull = (v: unknown): number | null => {
    const n = nonNegativeOrNull(v);
    return n != null && n <= 360 ? n % 360 : null;
  };
  const ts = Number(raw.ts);
  return {
    lat: normalizeGpsCoordinate(lat)!,
    lng: normalizeGpsCoordinate(lng)!,
    accuracy: nonNegativeOrNull(raw.accuracy),
    speed: nonNegativeOrNull(raw.speed),
    heading: headingOrNull(raw.heading),
    ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
  };
}
