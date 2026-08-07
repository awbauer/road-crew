import { apiUrl } from "@/api/client";
import { accessFetch } from "@/api/accessFetch";
import { CONFIG } from "@/config";
import type { Van } from "@road-crew/contracts";
import { fetchVanRoster } from "./vanRoster.js";

/**
 * Loads the active van roster. Native van installs must use the Access-aware
 * fetcher: the same service-token headers that authorize heartbeats are needed
 * for the live roster request as well.
 */
export async function fetchVans(): Promise<Van[]> {
  const paths = [apiUrl("/data/vans.json")];
  if (CONFIG.vanInstallEnabled) paths.unshift(apiUrl(CONFIG.vansPath));
  return fetchVanRoster(accessFetch, paths) as Promise<Van[]>;
}
