// Point-to-polyline distance math. Pure functions, no DOM, no I/O.
// Ported verbatim from app/js/pathDistance.js; behavior is intentionally unchanged.

import type { RoutePath } from "@road-crew/contracts";
import { haversine, bearingTo, angularDelta } from "./nearest.ts";

const TO_RAD = Math.PI / 180;

function projectPointOnSegment(
  lat: number,
  lng: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): { fraction: number; lat: number; lng: number } {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLng = (lng2 - lng1) * TO_RAD * Math.cos(((lat1 + lat2) / 2) * TO_RAD);
  const segLen2 = dLat * dLat + dLng * dLng;
  if (segLen2 === 0) return { fraction: 0, lat: lat1, lng: lng1 };

  const pLat = (lat - lat1) * TO_RAD;
  const pLng = (lng - lng1) * TO_RAD * Math.cos(((lat1 + lat) / 2) * TO_RAD);
  const t = Math.max(0, Math.min(1, (pLat * dLat + pLng * dLng) / segLen2));

  return {
    fraction: t,
    lat: lat1 + t * (lat2 - lat1),
    lng: lng1 + t * (lng2 - lng1),
  };
}

export interface NearestPointOnPath {
  distance: number;
  segmentIndex: number;
  fraction: number;
  point: [number, number] | null;
}

export function nearestPointOnPath(path: RoutePath, lat: number, lng: number): NearestPointOnPath | null {
  if (!path || path.length < 2) return null;

  let bestDist = Infinity;
  let bestSegment = 0;
  let bestFraction = 0;
  let bestPoint: [number, number] | null = null;

  for (let i = 0; i < path.length - 1; i++) {
    const [lng1, lat1] = path[i];
    const [lng2, lat2] = path[i + 1];
    const proj = projectPointOnSegment(lat, lng, lat1, lng1, lat2, lng2);
    const d = haversine(lat, lng, proj.lat, proj.lng);
    if (d < bestDist) {
      bestDist = d;
      bestSegment = i;
      bestFraction = proj.fraction;
      bestPoint = [proj.lng, proj.lat];
    }
  }

  return { distance: bestDist, segmentIndex: bestSegment, fraction: bestFraction, point: bestPoint };
}

export function pathBearingAt(path: RoutePath, segmentIndex: number): number | null {
  if (!path || segmentIndex < 0 || segmentIndex >= path.length - 1) return null;
  const [lng1, lat1] = path[segmentIndex];
  const [lng2, lat2] = path[segmentIndex + 1];
  return bearingTo(lat1, lng1, lat2, lng2);
}

export function pathTraversalDirection(
  path: RoutePath,
  segmentIndex: number,
  heading: number | null | undefined,
): "forward" | "reverse" | null {
  if (heading == null || !isFinite(heading)) return null;
  const bearing = pathBearingAt(path, segmentIndex);
  if (bearing == null) return null;
  const delta = angularDelta(heading, bearing);
  if (delta < 70) return "forward";
  if (delta > 110) return "reverse";
  return null;
}
