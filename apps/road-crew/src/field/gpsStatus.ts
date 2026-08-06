import type { Route } from "@road-crew/contracts";
import { nearestPointOnPath, nearestSequences, formatSpeed, formatDistance, formatHeading } from "@road-crew/core";
import type { Fix } from "./geolocation-types.ts";

// The on/off-route corridor uses hysteresis: two thresholds with a dead band
// between them, so a van hovering near the edge doesn't flicker between "On
// route" and "Off route" as the fix jitters.
//
// Once on route, you stay on route until you're further than this.
const OFF_ROUTE_METERS = 80;
// Once off route, you have to come back inside this to be on route again.
const ON_ROUTE_METERS = 50;
// Blink the next-target outline within 100 yards of the next sequence.
const BLINK_METERS = 91.44;
// A fix this inaccurate can't support a corridor check at all: the error alone
// is wider than the corridor, so the distance-to-route it produces is noise.
// Such fixes are reported as a GPS error rather than being resolved to on/off
// route. 100 yards.
const MAX_ACCURACY_METERS = 91.44;

/**
 * Resolves the corridor with hysteresis. `previousOnRoute` is the last
 * *resolved* state (fixes rejected for poor accuracy don't count), so the dead
 * band between the two thresholds holds whatever the state already was.
 */
function resolveOnRoute(distance: number, previousOnRoute: boolean | null): boolean {
  // Already on route: only a clear departure past the outer threshold flips it.
  if (previousOnRoute === true) return distance <= OFF_ROUTE_METERS;
  // Off route, or no state yet (app start / first fix): require the tighter
  // inner threshold, so "On route" always means genuinely on the route.
  return distance <= ON_ROUTE_METERS;
}

export interface GpsStatus {
  speedLabel: string;
  headingLabel: string;
  onRoute: boolean | null; // null = waiting / no path / fix too inaccurate to judge
  statusLabel: string; // "On route" / "Off route" / "Acquiring GPS…" / "Weak GPS"
  /** True when the fix was rejected as too inaccurate to place against the route. */
  accuracyRejected: boolean;
  distanceLabel: string | null; // off-route distance back to the route
  progress: number; // 0..1 along the active route path
  // Nearest bracketing pair (for the next/prev bar + next-target highlight).
  nextSeqNum: number | null;
  prevSeqNum: number | null;
  nextDistanceLabel: string | null;
  prevDistanceLabel: string | null;
  // Street-sign content (shown when on route) — the road you're CURRENTLY on.
  signStreet: string | null;
  signTown: string | null;
  // Blink the next-target outline when within 100 yards.
  withinBlink: boolean;
  // Which way along the route you're travelling (reverse = patrolling backward).
  direction: "forward" | "reverse" | null;
}

const EMPTY_PAIR = {
  nextSeqNum: null,
  prevSeqNum: null,
  nextDistanceLabel: null,
  prevDistanceLabel: null,
  signStreet: null,
  signTown: null,
  withinBlink: false,
  direction: null,
} as const;

/**
 * Derives the GPS-panel + follow state from a fix + the active route. Pure.
 *
 * `previousOnRoute` is the last resolved on/off-route state, which drives the
 * corridor hysteresis; pass `null` (the default) for a stateless read. Callers
 * rendering the panel should use `useGpsStatus`, which threads this for them.
 */
export function computeGpsStatus(
  fix: Fix | null,
  route: Route | undefined,
  previousOnRoute: boolean | null = null,
): GpsStatus {
  if (!fix) {
    return {
      speedLabel: "—",
      headingLabel: "—",
      onRoute: null,
      statusLabel: "Acquiring GPS…",
      accuracyRejected: false,
      distanceLabel: null,
      progress: 0,
      ...EMPTY_PAIR,
    };
  }
  const speedLabel = formatSpeed(fix.speed);
  const headingLabel = formatHeading(fix.heading);
  // A null accuracy means the platform didn't report one — we can't judge the
  // fix, so it's taken at face value rather than discarded.
  const accuracyRejected = fix.accuracy != null && fix.accuracy > MAX_ACCURACY_METERS;

  // Nearest bracketing pair → next/prev + street-sign + blink.
  const pair = route ? nearestSequences(route.sequences, fix.lat, fix.lng, { heading: fix.heading ?? null }) : null;
  const nextDist = pair?.next?.distance ?? null;
  const pairInfo = pair
    ? {
        nextSeqNum: pair.next.seq.seq,
        prevSeqNum: pair.previous.seq.seq,
        nextDistanceLabel: formatDistance(pair.next.distance),
        prevDistanceLabel: formatDistance(pair.previous.distance),
        // Sign shows the road you're currently on. Each sequence's `street` is
        // the road you travel *after* that GPS point until the next sequence, so
        // the segment you're on is named by its lower-index end = routeStart —
        // in either travel direction. (Using `previous` would read the wrong
        // road in reverse, since `previous`/`next` swap ends when patrolling
        // backward.)
        signStreet: (pair.routeStart.seq.street as string | null) ?? null,
        signTown: (pair.routeStart.seq.town as string | null) ?? null,
        // The blink is a 100-yard proximity cue, so it needs a fix accurate
        // enough to mean it. The coarse next/prev bar still reads fine on a
        // weak fix (sequences sit far further apart than the error), so that
        // stays populated rather than blanking out on the driver.
        withinBlink: !accuracyRejected && nextDist != null && nextDist <= BLINK_METERS,
        direction: pair.direction,
      }
    : EMPTY_PAIR;

  // Too inaccurate to place against the route: report the GPS problem instead
  // of a corridor verdict. onRoute stays null, so the caller holds the last
  // resolved state and hysteresis resumes from it once the fix recovers.
  if (accuracyRejected) {
    return {
      speedLabel,
      headingLabel,
      onRoute: null,
      statusLabel: "Weak GPS",
      accuracyRejected: true,
      distanceLabel: null,
      progress: 0,
      ...pairInfo,
    };
  }

  const path = route?.path;
  const near = path && path.length >= 2 ? nearestPointOnPath(path, fix.lat, fix.lng) : null;
  if (!near) {
    return {
      speedLabel,
      headingLabel,
      onRoute: null,
      statusLabel: "GPS ready",
      accuracyRejected: false,
      distanceLabel: null,
      progress: 0,
      ...pairInfo,
    };
  }
  const onRoute = resolveOnRoute(near.distance, previousOnRoute);
  return {
    speedLabel,
    headingLabel,
    onRoute,
    statusLabel: onRoute ? "On route" : "Off route",
    accuracyRejected: false,
    distanceLabel: onRoute ? null : formatDistance(near.distance),
    progress: near.segmentIndex / (path!.length - 1),
    ...pairInfo,
  };
}
