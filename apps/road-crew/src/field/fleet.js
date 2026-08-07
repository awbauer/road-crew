/**
 * Pure helpers for the fleet map layer.
 *
 * Vans are coloured by how old their GPS fix is: fresh (< 10 min), stale
 * (< 30 min), old (30 min+). `selectFleet` sanitizes the raw `/api/locations`
 * payload, drops the viewer's own van, and annotates each entry with its age +
 * bucket so the map layer is a straight render.
 *
 * Authored as plain ESM (typed by fleet.d.ts) so it runs under `node --test`
 * without a TypeScript toolchain.
 */

import { nearestSequences } from "@road-crew/core";

export const FLEET_FRESH_MS = 10 * 60 * 1000; // < 10 min → fresh
export const FLEET_STALE_MS = 30 * 60 * 1000; // < 30 min → stale, else old

// A shared orange family keeps fleet vans visually separate from Cumberland
// Farms while retaining the fresh / stale / old age signal. Both map adapters
// consume these values so web and native cannot drift.
export const FLEET_BUCKET_COLOR = Object.freeze({
  fresh: "#ff8c00",
  stale: "#d96800",
  old: "#925a2c",
});
export const FLEET_CLUSTER_COLOR = FLEET_BUCKET_COLOR.fresh;
export const FLEET_CLUSTER_TEXT_COLOR = "#1a1a1a";

/** Bucket a fix age (ms) into "fresh" | "stale" | "old". */
export function fixAgeBucket(ageMs) {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return "old";
  if (age < FLEET_FRESH_MS) return "fresh";
  if (age < FLEET_STALE_MS) return "stale";
  return "old";
}

/** Format a fleet fix age for the van popup. */
export function formatFleetLastSeen(ageMs) {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return "Unknown";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "<1m ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

/**
 * Sanitize the fleet payload for rendering: keep well-formed entries, drop the
 * viewer's own van (identified by van id or reporting device id), and annotate
 * each with `ageMs` + `bucket`.
 */
export function selectFleet(locations, { selfVanId = null, selfDeviceId = null, now = Date.now() } = {}) {
  if (!Array.isArray(locations)) return [];
  const out = [];
  for (const raw of locations) {
    if (!raw || typeof raw !== "object") continue;
    const vanId = typeof raw.vanId === "string" ? raw.vanId : String(raw.vanId ?? "");
    if (!vanId) continue;
    if (selfVanId != null && vanId === String(selfVanId)) continue;
    if (selfDeviceId != null && raw.deviceId != null && raw.deviceId === selfDeviceId) continue;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!isValidLatLng(lat, lng)) continue;
    const ts = Number(raw.ts) || 0;
    const ageMs = Math.max(0, now - ts);
    const heading = typeof raw.heading === "number" && Number.isFinite(raw.heading) ? raw.heading : null;
    const routeId = typeof raw.routeId === "string" && raw.routeId.trim() ? raw.routeId.trim() : null;
    out.push({
      vanId,
      lat,
      lng,
      ts,
      ageMs,
      bucket: fixAgeBucket(ageMs),
      heading,
      routeId,
    });
  }
  return out;
}

/**
 * Resolve the van's selected route. Older fleet records may not carry a route
 * id, so fall back to the geographically nearest route.
 */
export function describeFleetMarker(marker, routes) {
  if (!marker || !Array.isArray(routes)) return null;
  const preferred = marker.routeId
    ? routes.find((route) => route?.id === marker.routeId)
    : null;
  if (preferred) {
    return {
      routeId: preferred.id,
      routeName: preferred.name || preferred.id,
    };
  }
  const matches = routes
    .map((route) => ({
      route,
      pair: nearestSequences(route?.sequences, marker.lat, marker.lng, { heading: marker.heading }),
    }))
    .filter((match) => match.pair)
    .sort((a, b) => a.pair.score - b.pair.score);
  const match = matches[0];
  if (!match) return null;
  return {
    routeId: match.route.id,
    routeName: match.route.name || match.route.id,
  };
}
