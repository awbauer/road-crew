import type { RouteData } from "@road-crew/contracts";

/**
 * Pipeline output carries a generation timestamp shared by the route catalog
 * and its path files. Use it to avoid publishing a new React/Mapbox object
 * identity when a forced refresh returns the same baked data.
 */
export function routeDataRevision(data: RouteData): string {
  const generatedAt = data.generated_at?.trim();
  return generatedAt ? `generated:${generatedAt}` : `payload:${JSON.stringify(data)}`;
}
