// "Where am I?" location resolution. Pure functions, no DOM, no I/O.
//
// Position, closest intersection, sequence pair and heading resolve from the
// *bundled* route data plus the current GPS fix, so the modal is useful in
// airplane mode. The address, and with it the authoritative town and street,
// come from the reverse geocoder — the route data is only granular at sequence
// points — and are merged in afterwards by `buildWhereAmIView` rather than
// being waited on. Offline, the route's own town and street stand in.

import type { RoutePath, Sequence } from "@road-crew/contracts";
import type { SanitizedFix } from "./gpsFix.ts";
import { haversine } from "./nearest.ts";
import { nearestSequence, nearestSequences } from "./nearest.ts";
import { nearestPointOnPath } from "./pathDistance.ts";

/** Straight-line radius searched for the closest intersection. */
export const INTERSECTION_MAX_METERS = 1_500;
/** How far off the route the fix may sit and still take its street/sequence. */
export const ROUTE_MATCH_METERS = 50;
/** Ceiling for the accuracy-widened route-match tolerance. */
export const ROUTE_MATCH_MAX_METERS = 150;
/** A bundled town only speaks for the fix while the route is this close. */
export const TOWN_MATCH_METERS = 2_000;
/** Below this speed `heading` is compass noise rather than travel direction. */
export const MIN_MOVEMENT_SPEED_MPS = 1.5;
/** Location age at which the fix is flagged stale in the modal. */
export const STALE_LOCATION_SECONDS = 30;
/** Location age at which a fresher fix should be requested. */
export const VERY_STALE_LOCATION_SECONDS = 120;
/** Accuracy at which the fix is flagged low confidence. */
export const LOW_ACCURACY_METERS = 50;
/** Accuracy at which the details are flagged as possibly wrong. */
export const POOR_ACCURACY_METERS = 100;

export type MatchConfidence = "high" | "low";
export type FieldSource = "route" | "address" | "none";
export type AsyncFieldStatus = "notRequested" | "loading" | "available" | "unavailable" | "failed";

export interface WhereAmICoordinate {
  lat: number;
  lng: number;
}

export interface IntersectionMatch {
  /** Display name, e.g. "Seekonk St & Union St". */
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  /** Sequence number the intersection was read from. */
  seq: number;
}

export interface SequencePosition {
  fromSequence: number | null;
  toSequence: number | null;
  nearestSequence: number;
  confidence: MatchConfidence;
}

export interface HeadingDisplay {
  degrees: number;
  cardinal: string;
  source: "course";
}

export interface LocationQuality {
  ageSeconds: number;
  accuracyMeters: number | null;
  isStale: boolean;
  /** Old enough that the caller should ask for a fresh fix. */
  needsRefresh: boolean;
  isLowAccuracy: boolean;
  isPoorAccuracy: boolean;
}

/** Everything the modal can show without a network call. */
export interface WhereAmILocalResult {
  coordinate: WhereAmICoordinate;
  timestampMs: number;
  quality: LocationQuality;
  town: string | null;
  street: string | null;
  intersection: IntersectionMatch | null;
  sequence: SequencePosition | null;
  heading: HeadingDisplay | null;
  /** Distance from the fix to the active route, when a route was supplied. */
  routeDistanceMeters: number | null;
}

/** A resolved address, from the reverse geocoder. */
export interface ResolvedAddress {
  formatted: string;
  street: string | null;
  locality: string | null;
}

export interface WhereAmIRouteContext {
  sequences: Sequence[];
  path?: RoutePath | null;
}

/** Display-ready result: local fields plus whatever the address added. */
export interface WhereAmIView {
  coordinate: WhereAmICoordinate;
  coordinateLabel: string;
  timestampMs: number;
  quality: LocationQuality;
  town: string | null;
  townSource: FieldSource;
  street: string | null;
  streetSource: FieldSource;
  fullAddress: string | null;
  addressStatus: AsyncFieldStatus;
  intersection: IntersectionMatch | null;
  intersectionLabel: string | null;
  intersectionDistanceLabel: string | null;
  sequence: SequencePosition | null;
  sequenceLabel: string | null;
  heading: HeadingDisplay | null;
  headingLabel: string | null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The bundled `intersection` field is authored either as a real crossing
 * ("Loyola Road & McKeown Road, Worcester") or as a plain address
 * ("1 McCarthy Lane, Worcester") for sequences that aren't at a junction. Only
 * the former is an intersection; the trailing town is dropped because the modal
 * shows the town on its own row.
 */
/** Drops a stray trailing comma and the comma some records leave before a
 * parenthetical route number ("Main St., (Rt. 109)" -> "Main St. (Rt. 109)"). */
function cleanStreetName(raw: string): string {
  return raw
    .replace(/,\s*$/, "")
    .replace(/,\s*(?=\()/, " ")
    .trim();
}

export function parseIntersectionName(raw: unknown): string | null {
  const value = text(raw);
  if (!value || !value.includes("&")) return null;

  const rawStreets = value.split("&").map((part) => part.trim()).filter(Boolean);
  if (rawStreets.length < 2) return null;

  // The bundled data authors "Street A & Street B, Town" — only the segment
  // after the final "&" carries the trailing town. Splitting the whole string
  // on its first comma truncated any street name that itself contains a
  // comma, e.g. "Main St., (Rt. 109) & North St., Town" lost the second
  // street and the town entirely, silently turning a real intersection into
  // "Intersection unavailable". The town is now read off only the last
  // comma-separated piece of the final segment.
  const lastIndex = rawStreets.length - 1;
  const lastPieces = rawStreets[lastIndex].split(",").map((p) => p.trim()).filter(Boolean);
  const lastStreet = lastPieces.length > 1 ? lastPieces.slice(0, -1).join(", ") : (lastPieces[0] ?? "");

  const streets = [...rawStreets.slice(0, lastIndex), lastStreet]
    .map(cleanStreetName)
    .filter(Boolean);

  // A crossing needs two distinct roads. Identical names on both sides are a
  // segmentation point on one street, not a junction.
  const distinct = new Set(streets.map((s) => s.toUpperCase()));
  if (streets.length < 2 || distinct.size < 2) return null;
  return streets.length === 2
    ? `${streets[0]} & ${streets[1]}`
    : `${streets.slice(0, -1).join(", ")} & ${streets[streets.length - 1]}`;
}

/**
 * The closest authored intersection by straight-line distance — geographic
 * proximity, not the next intersection along the route. A bounding box around
 * `maxMeters` rejects most candidates before any haversine runs, so one pass
 * over the route's sequences covers both the near and the widened radius.
 */
export function closestIntersection(
  sequences: Sequence[] | null | undefined,
  lat: number,
  lng: number,
  { maxMeters = INTERSECTION_MAX_METERS } = {},
): IntersectionMatch | null {
  if (!Array.isArray(sequences) || !finite(lat) || !finite(lng)) return null;
  // A degree of latitude is ~111.32 km everywhere; longitude shrinks with
  // latitude. The box is a cheap reject so the haversine only runs on plausible
  // candidates.
  const latSpan = maxMeters / 111_320;
  const lngSpan = latSpan / Math.max(0.1, Math.cos(lat * (Math.PI / 180)));
  let best: IntersectionMatch | null = null;
  for (const seq of sequences) {
    if (!finite(seq?.lat) || !finite(seq?.lng)) continue;
    const sLat = seq.lat as number;
    const sLng = seq.lng as number;
    if (Math.abs(sLat - lat) > latSpan || Math.abs(sLng - lng) > lngSpan) continue;
    const name = parseIntersectionName(seq.intersection);
    if (!name) continue;
    const distanceMeters = haversine(lat, lng, sLat, sLng);
    if (distanceMeters > maxMeters) continue;
    if (!best || distanceMeters < best.distanceMeters) {
      best = { name, lat: sLat, lng: sLng, distanceMeters, seq: seq.seq };
    }
  }
  return best;
}

export function cardinalDirection(degrees: number | null | undefined): string | null {
  if (!finite(degrees)) return null;
  const value = ((degrees % 360) + 360) % 360;
  if (value >= 337.5 || value < 22.5) return "North";
  if (value < 67.5) return "Northeast";
  if (value < 112.5) return "East";
  if (value < 157.5) return "Southeast";
  if (value < 202.5) return "South";
  if (value < 247.5) return "Southwest";
  if (value < 292.5) return "West";
  return "Northwest";
}

/**
 * `heading` is only the direction of travel while the van is actually moving.
 * Standing still it is either stale or the device compass, and showing that as
 * travel direction sends a driver the wrong way.
 */
export function resolveHeading(fix: SanitizedFix): HeadingDisplay | null {
  if (!finite(fix.heading) || (fix.heading as number) < 0) return null;
  if (!finite(fix.speed) || (fix.speed as number) < MIN_MOVEMENT_SPEED_MPS) return null;
  const cardinal = cardinalDirection(fix.heading);
  if (!cardinal) return null;
  return { degrees: fix.heading as number, cardinal, source: "course" };
}

export function locationQuality(fix: SanitizedFix, nowMs: number = Date.now()): LocationQuality {
  const ageSeconds = Math.max(0, (nowMs - fix.ts) / 1000);
  const accuracyMeters = finite(fix.accuracy) ? (fix.accuracy as number) : null;
  return {
    ageSeconds,
    accuracyMeters,
    isStale: ageSeconds >= STALE_LOCATION_SECONDS,
    needsRefresh: ageSeconds >= VERY_STALE_LOCATION_SECONDS,
    isLowAccuracy: accuracyMeters != null && accuracyMeters >= LOW_ACCURACY_METERS,
    isPoorAccuracy: accuracyMeters != null && accuracyMeters > POOR_ACCURACY_METERS,
  };
}

/**
 * How far off the route the fix may sit and still be treated as on it. A poor
 * fix widens the corridor — the van hasn't moved, the error ellipse has grown —
 * but the match is then reported as low confidence.
 */
export function routeMatchTolerance(accuracyMeters: number | null): number {
  if (accuracyMeters == null || accuracyMeters <= 25) return ROUTE_MATCH_METERS;
  return Math.min(ROUTE_MATCH_METERS + accuracyMeters, ROUTE_MATCH_MAX_METERS);
}

/**
 * Resolves every offline field from the fix and the active route. This is the
 * work that must finish before the modal is presented, so it stays a couple of
 * linear passes over the route's sequences.
 */
export function resolveLocalWhereAmI(
  fix: SanitizedFix,
  route: WhereAmIRouteContext | null | undefined,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): WhereAmILocalResult {
  const quality = locationQuality(fix, nowMs);
  const sequences = route?.sequences ?? null;
  const tolerance = routeMatchTolerance(quality.accuracyMeters);

  const pair = sequences ? nearestSequences(sequences, fix.lat, fix.lng, { heading: fix.heading }) : null;
  const nearest = sequences ? nearestSequence(sequences, fix.lat, fix.lng) : null;
  const path = route?.path && route.path.length >= 2 ? nearestPointOnPath(route.path, fix.lat, fix.lng) : null;
  // Distance to the route: the polyline when the route ships one, otherwise the
  // closest sequence point (a coarser but still usable proxy).
  const routeDistanceMeters = path?.distance ?? nearest?.distance ?? null;
  const onRoute = routeDistanceMeters != null && routeDistanceMeters <= tolerance;

  let sequence: SequencePosition | null = null;
  if (pair) {
    sequence = onRoute
      ? {
          fromSequence: pair.previous.seq.seq,
          toSequence: pair.next.seq.seq,
          nearestSequence: pair.anchor.seq.seq,
          confidence: quality.isLowAccuracy ? "low" : "high",
        }
      : {
          // Off route there is no segment to name, so only the nearest sequence
          // is reported rather than inventing a pair.
          fromSequence: null,
          toSequence: null,
          nearestSequence: pair.anchor.seq.seq,
          confidence: "low",
        };
  } else if (nearest) {
    sequence = { fromSequence: null, toSequence: null, nearestSequence: nearest.seq.seq, confidence: "low" };
  }

  // `street` on a sequence names the road travelled *after* that point, so the
  // segment you are on is named by its lower-index end (see the Sequence docs).
  const street = onRoute && pair ? text(pair.routeStart.seq.street) : null;
  // Town follows the *closest* sequence rather than the segment's lower end:
  // a segment can straddle a town line, and the nearer point is the better
  // answer to "what town am I in".
  const townSeq = pair?.anchor.seq ?? nearest?.seq ?? null;
  const townWithinRange = routeDistanceMeters != null && routeDistanceMeters <= TOWN_MATCH_METERS;
  const town = townWithinRange && townSeq ? text(townSeq.town) : null;

  return {
    coordinate: { lat: fix.lat, lng: fix.lng },
    timestampMs: fix.ts,
    quality,
    town,
    street,
    intersection: closestIntersection(sequences, fix.lat, fix.lng),
    sequence,
    heading: resolveHeading(fix),
    routeDistanceMeters,
  };
}

export function formatCoordinates(coordinate: WhereAmICoordinate): string {
  return `${coordinate.lat.toFixed(5)}, ${coordinate.lng.toFixed(5)}`;
}

/**
 * A leading house number: "350 Greenwood St", "12-14 Main St", "1A Elm St".
 * Deliberately not a bare `^\d` — "1st Avenue" and "3rd St" are road names, not
 * numbered addresses, and treating them as numbered would suppress the fallback
 * below on exactly the streets that need it.
 */
const HOUSE_NUMBER = /^\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?\s/;

export function hasHouseNumber(value: string | null | undefined): boolean {
  const trimmed = text(value);
  return trimmed != null && HOUSE_NUMBER.test(trimmed);
}

/**
 * The number-and-street segment of a formatted address, or null when it has no
 * house number to offer.
 *
 * Only the first comma-separated piece is taken. `formatted` is a full postal
 * address ("350 Greenwood St, Millbury, Massachusetts 01527, United States")
 * and the card shows the town on its own line, so the rest is duplication on
 * what is the panel's largest line.
 */
export function houseNumberedStreet(formatted: string | null | undefined): string | null {
  const first = text(text(formatted)?.split(",")[0]);
  return first && hasHouseNumber(first) ? first : null;
}

/**
 * Proximity wording. Deliberately never "ahead" or "behind": this is the
 * geographically closest intersection, which may be behind the van.
 */
export function formatIntersectionDistance(meters: number | null | undefined): string | null {
  if (!finite(meters)) return null;
  const feet = (meters as number) * 3.28084;
  if (feet < 30) return "At intersection";
  if (feet < 1000) return `${Math.round(feet)} ft away`;
  return `${(feet / 5280).toFixed(1)} mi away`;
}

export function formatSequencePosition(sequence: SequencePosition | null | undefined): string | null {
  if (!sequence) return null;
  if (sequence.fromSequence != null && sequence.toSequence != null) {
    return `Between ${sequence.fromSequence} & ${sequence.toSequence}`;
  }
  // No bracketing pair means the fix isn't confidently placed on the route —
  // see resolveLocalWhereAmI's onRoute check — so this covers both a genuine
  // off-route fix and the rare case of a route too short to bracket at all.
  return "Off Route";
}

/**
 * Merges the async address into the local result.
 *
 * The geocoded town and street win when they are present: the bundled route
 * data is only granular at sequence points, so between two cues it names the
 * road the cue sent you down rather than the one you are on. The route values
 * stay as the offline fallback, which is why they are still resolved first.
 *
 * `street` is the panel's focal line, so it prefers a form carrying the house
 * number. Mapbox only puts one in the street field for an `address` feature; on
 * the rural roads these routes run it answers with a `street` feature instead,
 * whose name is just the road. The formatted address often still has the number,
 * so it is the fallback — reduced to its first segment, since the town has its
 * own line. Route data never carries a number at all.
 */
export function buildWhereAmIView(
  local: WhereAmILocalResult,
  address: ResolvedAddress | null,
  addressStatus: AsyncFieldStatus = "notRequested",
): WhereAmIView {
  const town = address?.locality ?? local.town ?? null;
  const geocodedStreet = address?.street ?? null;
  const numberedStreet = hasHouseNumber(geocodedStreet)
    ? null
    : houseNumberedStreet(address?.formatted);
  const street = numberedStreet ?? geocodedStreet ?? local.street ?? null;
  return {
    coordinate: local.coordinate,
    coordinateLabel: formatCoordinates(local.coordinate),
    timestampMs: local.timestampMs,
    quality: local.quality,
    town,
    townSource: address?.locality ? "address" : town ? "route" : "none",
    street,
    // The number can come from the formatted address while the street field
    // itself was empty, so the source follows whichever one supplied the value.
    streetSource: numberedStreet || geocodedStreet ? "address" : street ? "route" : "none",
    fullAddress: address?.formatted ?? null,
    addressStatus,
    intersection: local.intersection,
    intersectionLabel: local.intersection?.name ?? null,
    intersectionDistanceLabel: formatIntersectionDistance(local.intersection?.distanceMeters ?? null),
    sequence: local.sequence,
    sequenceLabel: formatSequencePosition(local.sequence),
    heading: local.heading,
    headingLabel: local.heading?.cardinal ?? null,
  };
}

/** Plain-text summary for Copy Info / Share. Unavailable fields are omitted. */
export function buildWhereAmIText(
  view: WhereAmIView,
  { relativeTime }: { relativeTime?: string | null } = {},
): string {
  const lines: string[] = [];
  if (view.town) lines.push(`Town: ${view.town}`);
  if (view.fullAddress) lines.push(`Address: ${view.fullAddress}`);
  if (view.intersectionLabel) lines.push(`Closest intersection: ${view.intersectionLabel}`);
  if (view.intersectionDistanceLabel) lines.push(`Intersection distance: ${view.intersectionDistanceLabel}`);
  if (view.street) lines.push(`Street: ${view.street}`);
  lines.push(`Coordinates: ${view.coordinateLabel}`);
  if (view.sequenceLabel) lines.push(`Sequence: ${view.sequenceLabel}`);
  if (view.headingLabel) lines.push(`Heading: ${view.headingLabel}`);
  if (relativeTime) lines.push(`Last updated: ${relativeTime}`);
  return lines.join("\n");
}

/** Apple Maps link for the coordinate, used by Share. */
export function appleMapsCoordinateUrl(coordinate: WhereAmICoordinate): string {
  return `https://maps.apple.com/?ll=${coordinate.lat.toFixed(5)},${coordinate.lng.toFixed(5)}&q=${encodeURIComponent("Current location")}`;
}

/** How far the van may move before the cached address stops applying: 100 yards. */
export const ADDRESS_REUSE_METERS = 91.44;
/** Cap on persisted address entries. */
export const ADDRESS_CACHE_LIMIT = 500;

export interface CachedAddress extends ResolvedAddress {
  lat: number;
  lng: number;
  timestampMs: number;
}

/**
 * Distance is the whole cache rule: an address is a fact about a place, so it
 * doesn't go stale sitting still — it stops applying once the van has driven
 * `ADDRESS_REUSE_METERS` away from where it was looked up. The timestamp is
 * kept only to evict the oldest entries when the cache fills.
 */
export function shouldReuseCachedAddress(
  cached: CachedAddress | null | undefined,
  lat: number,
  lng: number,
): boolean {
  if (!cached || !finite(cached.lat) || !finite(cached.lng)) return false;
  return haversine(lat, lng, cached.lat, cached.lng) <= ADDRESS_REUSE_METERS;
}

/**
 * Spatial cache key: ~11 m of latitude per 0.0001°, which keeps a stopped van
 * on one key without collapsing separate stops together. Never key on the raw
 * float — no two fixes are ever equal.
 */
export function addressCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}
