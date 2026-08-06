import type { CumberlandFarm } from "@road-crew/contracts";
import { haversine } from "./nearest.ts";

export interface NearestCumberlandFarmResult {
  farm: CumberlandFarm;
  distance: number;
}

export interface CumberlandFarmCluster {
  id: string;
  farms: CumberlandFarm[];
  lat: number;
  lng: number;
}

export const CUMBERLAND_FARM_CLUSTER_DISTANCE_METERS = 1_500;

/** Keep canonical zero-padded IDs in data, but show store numbers naturally in UI. */
export function displayCumberlandFarmStoreNumber(storeNumber: string): string {
  const normalized = storeNumber.trim().replace(/^0+(?=\d)/, "");
  return normalized || "0";
}

/** Scale the store grouping radius with the map zoom so clusters open up as the user zooms in. */
export function cumberlandFarmClusterDistanceForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return CUMBERLAND_FARM_CLUSTER_DISTANCE_METERS;
  return Math.max(100, Math.min(120_000, CUMBERLAND_FARM_CLUSTER_DISTANCE_METERS * 2 ** (11 - zoom)));
}

/** Group nearby stores so dense town centers do not turn into overlapping map markers. */
export function clusterCumberlandFarms(
  farms: readonly CumberlandFarm[],
  maxDistanceMeters = CUMBERLAND_FARM_CLUSTER_DISTANCE_METERS,
): CumberlandFarmCluster[] {
  const clusters: CumberlandFarmCluster[] = [];
  for (const farm of farms) {
    if (!Number.isFinite(farm.lat) || !Number.isFinite(farm.lng)) continue;
    const nearestCluster = clusters
      .map((cluster) => ({ cluster, distance: haversine(farm.lat, farm.lng, cluster.lat, cluster.lng) }))
      .filter(({ distance }) => distance <= maxDistanceMeters)
      .sort((a, b) => a.distance - b.distance)[0]?.cluster;
    if (nearestCluster) {
      nearestCluster.farms.push(farm);
      nearestCluster.lat = nearestCluster.farms.reduce((sum, item) => sum + item.lat, 0) / nearestCluster.farms.length;
      nearestCluster.lng = nearestCluster.farms.reduce((sum, item) => sum + item.lng, 0) / nearestCluster.farms.length;
    } else {
      clusters.push({ id: `cf-cluster-${farm.id}`, farms: [farm], lat: farm.lat, lng: farm.lng });
    }
  }
  return clusters;
}

export function nearestCumberlandFarm(
  farms: readonly CumberlandFarm[],
  lat: number,
  lng: number,
): NearestCumberlandFarmResult | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let nearest: NearestCumberlandFarmResult | null = null;
  for (const farm of farms) {
    if (!Number.isFinite(farm.lat) || !Number.isFinite(farm.lng)) continue;
    const distance = haversine(lat, lng, farm.lat, farm.lng);
    if (!nearest || distance < nearest.distance) nearest = { farm, distance };
  }
  return nearest;
}

export function cumberlandFarmNavigationHref(
  farm: CumberlandFarm | null | undefined,
  providerId = "apple",
): string {
  if (!farm || !Number.isFinite(farm.lat) || !Number.isFinite(farm.lng)) return "#";
  const destination = `${farm.lat},${farm.lng}`;
  if (providerId === "google") return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  if (providerId === "waze") return `https://waze.com/ul?ll=${destination}&navigate=yes`;
  return `https://maps.apple.com/?daddr=${destination}&dirflg=d`;
}

export function cumberlandFarmNavigationScheme(
  farm: CumberlandFarm | null | undefined,
  providerId = "apple",
): string {
  if (!farm || !Number.isFinite(farm.lat) || !Number.isFinite(farm.lng)) return "#";
  const destination = `${farm.lat},${farm.lng}`;
  if (providerId === "google") return `comgooglemaps://?daddr=${destination}&directionsmode=driving`;
  if (providerId === "waze") return `waze://?ll=${destination}&navigate=yes`;
  return `maps://?daddr=${destination}&dirflg=d`;
}
