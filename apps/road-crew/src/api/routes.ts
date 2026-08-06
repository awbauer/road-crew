import { loadSequences } from "@road-crew/data";
import { CONFIG } from "@/config";
import type { RouteSummary } from "@road-crew/contracts";
import { accessFetch } from "@/api/accessFetch";

/**
 * Loads the summary view used by the legacy chat route from the canonical
 * shared route-data loader.
 */
export async function fetchRoutes(): Promise<RouteSummary[]> {
  const payload = await loadSequences({ baseUrl: CONFIG.apiBaseUrl, fetchImpl: accessFetch });
  const routes = Array.isArray(payload.routes) ? payload.routes : [];
  return routes.map((r) => ({
    id: r.id,
    day: Number(r.day),
    route: Number(r.route),
    name: r.name || r.id,
    start_town: r.start_town || "",
    end_town: r.end_town || "",
    official_miles: Number(r.official_miles || 0),
    sequence_count: Number(r.sequence_count ?? r.sequences.length),
  }));
}
