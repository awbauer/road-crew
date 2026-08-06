import type { RouteData } from "@road-crew/contracts";

/** Native ships the canonical route catalog; web relies on its precached export. */
export function loadBundledRouteData(): RouteData | null;
