// Redacts GPS/location fields from arbitrary data before it leaves the device
// (e.g. Sentry event extras/contexts). Ported from app/js/monitoring.js.

const SENSITIVE_FIELD_NAMES = new Set([
  "lat",
  "latitude",
  "lng",
  "lon",
  "long",
  "longitude",
  "coords",
  "coordinates",
]);

export function redactSensitiveFields(value: unknown, seen: WeakMap<object, unknown> = new WeakMap()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, seen));
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value as object)) return seen.get(value as object);

  const clone: Record<string, unknown> = {};
  seen.set(value as object, clone);

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_NAMES.has(key.toLowerCase())) {
      clone[key] = "[redacted]";
      continue;
    }
    clone[key] = redactSensitiveFields(raw, seen);
  }
  return clone;
}
