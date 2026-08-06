import type { RouteData, RoutePath } from "@road-crew/contracts";

const sequences = require("../../../../packages/data/routes/sequences.json") as RouteData;
const paths: Record<string, RoutePath> = {
  day1_route1: require("../../../../packages/data/routes/paths/day1_route1.json") as RoutePath,
  day1_route2: require("../../../../packages/data/routes/paths/day1_route2.json") as RoutePath,
  day2_route1: require("../../../../packages/data/routes/paths/day2_route1.json") as RoutePath,
  day2_route2: require("../../../../packages/data/routes/paths/day2_route2.json") as RoutePath,
  day2_route3: require("../../../../packages/data/routes/paths/day2_route3.json") as RoutePath,
};

/**
 * Return a mutable copy because the shared loader normalizes detour ordering.
 * Keeping the source JSON untouched makes repeated native cold starts stable.
 */
export function loadBundledRouteData(): RouteData {
  return {
    ...sequences,
    routes: sequences.routes.map((route) => ({
      ...route,
      sequences: route.sequences.map((sequence) => ({ ...sequence })),
      path: paths[route.id]?.map((coordinate) => [...coordinate] as [number, number]),
    })),
  };
}
