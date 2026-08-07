import { apiFetch } from "@/api/client";
import { CONFIG } from "@/config";
import type { ListLocationsResponse, VanLocation } from "@road-crew/contracts";

/** Loads the whole fleet's latest positions (public endpoint). */
export async function fetchLocations(): Promise<VanLocation[]> {
  const payload = await apiFetch<ListLocationsResponse>(CONFIG.locationsPath);
  return Array.isArray(payload.locations) ? payload.locations : [];
}
