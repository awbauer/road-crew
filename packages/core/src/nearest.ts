// Haversine + nearest-sequence-point lookups. Pure functions, no DOM, no I/O.
// Ported verbatim from app/js/nearest.js; behavior is intentionally unchanged.

import type { Sequence } from "@road-crew/contracts";

const R = 6371000; // earth mean radius, metres
const TO_RAD = Math.PI / 180;

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLng = (lng2 - lng1) * TO_RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * TO_RAD) * Math.cos(lat2 * TO_RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface NearestSequenceResult {
  index: number;
  seq: Sequence;
  distance: number;
  score: number;
}

// Returns { index, seq, distance } for the closest sequence in `sequences`
// (an array of { seq, lat, lng, ... }). Sequences without coords are skipped.
/**
 * Below this speed (m/s, about 2 mph) a course is noise: a parked or
 * crawling van's heading wanders, and iOS reports -1 for "unknown".
 */
export const MIN_DIRECTION_SPEED_MPS = 1;

/**
 * The heading to steer by, or null. A heading counts only when it is a real
 * course (finite, 0–360) and the van is moving: with a known speed under
 * `MIN_DIRECTION_SPEED_MPS` it is ignored. An unknown speed keeps a valid
 * heading, since some platforms report a course without one.
 */
export function directionHeading(heading: number | null | undefined, speed: number | null | undefined = null): number | null {
  if (heading == null || !Number.isFinite(heading) || heading < 0 || heading > 360) return null;
  if (speed != null && Number.isFinite(speed) && speed < MIN_DIRECTION_SPEED_MPS) return null;
  return heading;
}

export function nearestSequence(
  sequences: Sequence[],
  lat: number,
  lng: number,
  { heading: rawHeading = null, speed = null }: { heading?: number | null; speed?: number | null } = {},
): NearestSequenceResult | null {
  const heading = directionHeading(rawHeading, speed);
  if (!Array.isArray(sequences) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: NearestSequenceResult | null = null;
  for (let i = 0; i < sequences.length; i++) {
    const s = sequences[i];
    // Require finite coords. A NaN coord at index 0 would otherwise seed `best`
    // with score=NaN and, since `NaN < x` is always false, lock out every
    // later valid sequence from ever winning.
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const sLat = s.lat as number;
    const sLng = s.lng as number;
    const d = haversine(lat, lng, sLat, sLng);
    const score = headingScore(d, lat, lng, sLat, sLng, heading);
    if (best === null || score < best.score) {
      best = { index: i, seq: s, distance: d, score };
    }
  }
  return best;
}

interface IndexedPoint {
  seq: Sequence;
  index: number;
  distance: number;
}

export interface NearestSequencesResult {
  routeStart: IndexedPoint;
  routeEnd: IndexedPoint;
  previous: IndexedPoint;
  next: IndexedPoint;
  anchor: IndexedPoint;
  direction: "forward" | "reverse" | null;
  score: number;
}

// Returns the nearest adjacent pair of sequence points by projecting the GPS fix
// onto adjacent route segments. This keeps Follow from advancing to the next
// pair until the fix has crossed onto that pair's segment.
export function nearestSequences(
  sequences: Sequence[],
  lat: number,
  lng: number,
  { heading: rawHeading = null, speed = null, traversalDir = null }: {
    heading?: number | null;
    /** Metres per second; a known speed below the threshold ignores heading. */
    speed?: number | null;
    traversalDir?: "forward" | "reverse" | null;
  } = {},
): NearestSequencesResult | null {
  if (!Array.isArray(sequences) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const heading = directionHeading(rawHeading, speed);

  const valid = sequences
    .map((seq, index) => ({ seq, index }))
    .filter(({ seq }) => hasSequenceCoords(seq));
  if (valid.length < 2) return null;

  const points: IndexedPoint[] = valid.map((point) => ({
    ...point,
    distance: haversine(lat, lng, point.seq.lat as number, point.seq.lng as number),
  }));
  const segment = nearestSegment(points, lat, lng);
  if (!segment) return null;

  const nearestIndex = segment.ratio < 0.5 ? segment.startPos : segment.endPos;
  const direction = traversalDir === "forward" || traversalDir === "reverse"
    ? traversalDir
    : pointTraversalDirection(points, nearestIndex, lat, lng, heading);

  const routeStart = points[segment.startPos];
  const routeEnd = points[segment.endPos];

  const previous = direction === "reverse" ? routeEnd : routeStart;
  const next = direction === "reverse" ? routeStart : routeEnd;

  return {
    routeStart,
    routeEnd,
    previous,
    next,
    anchor: points[nearestIndex],
    direction,
    score: previous.distance + next.distance,
  };
}

interface SegmentProjection {
  startPos: number;
  endPos: number;
  ratio: number;
  distance: number;
}

function nearestSegment(points: IndexedPoint[], lat: number, lng: number): SegmentProjection | null {
  let best: SegmentProjection | null = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const projection = projectToSegment(lat, lng, points[i].seq, points[i + 1].seq);
    if (!best || projection.distance < best.distance) {
      best = { startPos: i, endPos: i + 1, ...projection };
    }
  }
  return best;
}

function projectToSegment(
  lat: number,
  lng: number,
  start: Sequence,
  end: Sequence,
): { ratio: number; distance: number } {
  const startLat = start.lat as number;
  const startLng = start.lng as number;
  const endLat = end.lat as number;
  const endLng = end.lng as number;
  const midLat = ((startLat + endLat) / 2) * TO_RAD;
  const metresPerLat = 111_320;
  const metresPerLng = Math.cos(midLat) * 111_320;
  const ax = startLng * metresPerLng;
  const ay = startLat * metresPerLat;
  const bx = endLng * metresPerLng;
  const by = endLat * metresPerLat;
  const px = lng * metresPerLng;
  const py = lat * metresPerLat;
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  const rawRatio = lenSq > 0 ? ((px - ax) * vx + (py - ay) * vy) / lenSq : 0;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const cx = ax + vx * ratio;
  const cy = ay + vy * ratio;
  const dx = px - cx;
  const dy = py - cy;
  return { ratio, distance: Math.hypot(dx, dy) };
}

function pointTraversalDirection(
  points: IndexedPoint[],
  currentIndex: number,
  lat: number,
  lng: number,
  heading: number | null,
): "forward" | "reverse" | null {
  if (!Number.isFinite(heading)) return null;
  const previous = points[currentIndex - 1];
  const next = points[currentIndex + 1];
  if (!previous && !next) return null;
  const forwardDelta = next
    ? angularDelta(heading as number, bearingTo(lat, lng, next.seq.lat as number, next.seq.lng as number))
    : Infinity;
  const reverseDelta = previous
    ? angularDelta(heading as number, bearingTo(lat, lng, previous.seq.lat as number, previous.seq.lng as number))
    : Infinity;
  return forwardDelta <= reverseDelta ? "forward" : "reverse";
}

function hasSequenceCoords(seq: Sequence): boolean {
  return Number.isFinite(seq?.lat) && Number.isFinite(seq?.lng);
}

/**
 * The van's current position expressed as a route mile marker (interpolated
 * `cum_miles`), derived the same way `nearestSequences` finds its bracketing
 * pair: by projecting the fix onto the nearest segment between two
 * consecutive sequence points, not by picking whichever sequence point is
 * closest as the crow flies. Sequences without a coordinate or a `cum_miles`
 * value are skipped, so a segment can span past missing data.
 *
 * Segments are built from `cum_miles` order, not the array's display order.
 * A route's detour sequences are spliced into the display list right after
 * their anchor point (so the printed cue sheet reads inline), but their
 * `cum_miles` keeps counting up from the pipeline's original traversal —
 * main route, then detour appended at the end — so in display order they sit
 * between two points many miles away in `cum_miles`. Projecting against that
 * display-order pair would let a fix on the real road between the anchor and
 * its true next point snap onto the detour instead, resolving to a position
 * dozens of miles off. Sorting by `cum_miles` first undoes exactly that
 * splice and restores true mile-adjacency for every pair.
 *
 * Returns `null` when there are fewer than two usable points to project onto.
 */
export function nearestRouteMileMarker(
  sequences: Sequence[],
  lat: number,
  lng: number,
): number | null {
  if (!Array.isArray(sequences) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const valid = sequences
    .filter((seq) => hasSequenceCoords(seq) && Number.isFinite(seq.cum_miles))
    .sort((a, b) => (a.cum_miles as number) - (b.cum_miles as number));
  if (valid.length < 2) return null;

  const points: IndexedPoint[] = valid.map((seq, index) => ({
    seq,
    index,
    distance: haversine(lat, lng, seq.lat as number, seq.lng as number),
  }));
  const segment = nearestSegment(points, lat, lng);
  if (!segment) return null;

  const startMiles = points[segment.startPos].seq.cum_miles as number;
  const endMiles = points[segment.endPos].seq.cum_miles as number;
  return startMiles + segment.ratio * (endMiles - startMiles);
}

function headingScore(
  distance: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  heading: number | null,
): number {
  if (heading == null || !isFinite(heading)) return distance;
  const bearing = bearingTo(lat1, lng1, lat2, lng2);
  const delta = angularDelta(heading, bearing);
  if (delta > 115) return distance * 1.45 + 75;
  if (delta < 55) return distance * 0.9;
  return distance;
}

export function bearingTo(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad)
    - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lng2 - lng1) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

export function angularDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// Format a distance in metres into a human-friendly string in feet/miles
// (US-centric — the routes are in Massachusetts).
export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || !isFinite(metres)) return "—";
  const feet = metres * 3.28084;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  const miles = feet / 5280;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

// Format a mileage value as "1.23 mi", but only when it's a real finite
// number. Bad data (string/NaN/null) returns null so callers render a dash
// instead of throwing inside `.toFixed`, which would blank a whole list render.
export function fmtMiles(value: number | null | undefined, digits = 1): string | null {
  if (!Number.isFinite(value)) return null;
  return `${(value as number).toFixed(digits)} mi`;
}

// `miles` is authored as the distance from this sequence to the next sequence.
// Gap rows use this source value first, falling back to cumulative-mile deltas
// only when the authored distance is missing.
export function distanceToNextSequenceMiles(
  sequences: Sequence[],
  fromIndex: number | null | undefined,
): number | null {
  if (!Array.isArray(sequences) || fromIndex == null) return null;
  const from = sequences[fromIndex];
  const next = sequences[fromIndex + 1];
  if (!from || !next) return null;
  const sourceMiles = Number.isFinite(from.miles) && (from.miles as number) >= 0 ? (from.miles as number) : null;
  if (sourceMiles != null) return sourceMiles;
  if (Number.isFinite(from.cum_miles) && Number.isFinite(next.cum_miles)) {
    return Math.abs((next.cum_miles as number) - (from.cum_miles as number));
  }
  return null;
}

export function formatSpeed(metresPerSec: number | null | undefined): string {
  if (metresPerSec == null || !isFinite(metresPerSec) || metresPerSec < 0) return "—";
  const mph = metresPerSec * 2.23694;
  return `${Math.round(mph)} mph`;
}

export function formatHeading(degrees: number | null | undefined): string {
  if (degrees == null || !isFinite(degrees)) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}
