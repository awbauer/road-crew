import { useEffect, useMemo, useRef } from "react";
import type { Route } from "@road-crew/contracts";
import { computeGpsStatus, type GpsStatus } from "./gpsStatus.ts";
import type { Fix } from "./geolocation-types.ts";

/**
 * `computeGpsStatus` with the on/off-route hysteresis threaded through.
 *
 * The corridor check needs the previous verdict to resolve the dead band
 * between its two thresholds, which a pure function can't hold on its own.
 * This keeps that one piece of state so every screen applies the corridor
 * identically — the alternative is each caller wiring its own ref and drifting.
 *
 * Only resolved verdicts are remembered. A `null` reading (no fix, no route
 * path, or a fix rejected as too inaccurate) leaves the stored state alone, so
 * a patch of weak GPS doesn't silently reset the driver to "off route" — the
 * corridor picks up from the last real verdict once the signal recovers.
 */
export function useGpsStatus(fix: Fix | null, route: Route | undefined): GpsStatus {
  const previousOnRoute = useRef<boolean | null>(null);
  const status = useMemo(
    () => computeGpsStatus(fix, route, previousOnRoute.current),
    // previousOnRoute is a ref, deliberately not a dependency: it's read at
    // compute time and only ever holds the prior render's verdict.
    [fix, route],
  );

  useEffect(() => {
    if (status.onRoute !== null) previousOnRoute.current = status.onRoute;
  }, [status.onRoute]);

  return status;
}
