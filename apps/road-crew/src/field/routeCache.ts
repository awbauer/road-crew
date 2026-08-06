import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RouteData } from "@road-crew/contracts";
import { validateRouteData } from "@road-crew/core";

const ROUTE_CACHE_KEY = "rc-route-data-v1";

function isRouteData(value: unknown): value is RouteData {
  return validateRouteData(value).length === 0;
}

/** Returns the last complete route payload saved by a successful refresh. */
export async function loadCachedRouteData(): Promise<RouteData | null> {
  try {
    const raw = await AsyncStorage.getItem(ROUTE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRouteData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Saves the fully hydrated payload, including optional route paths. */
export async function saveCachedRouteData(data: RouteData): Promise<void> {
  try {
    await AsyncStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Route data remains usable in memory if storage is full or unavailable.
  }
}
