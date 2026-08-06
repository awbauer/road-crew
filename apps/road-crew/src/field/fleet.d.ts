import type { Route, VanLocation } from "@road-crew/contracts";

export const FLEET_FRESH_MS: number;
export const FLEET_STALE_MS: number;

export type FleetBucket = "fresh" | "stale" | "old";

export const FLEET_BUCKET_COLOR: Readonly<Record<FleetBucket, string>>;
export const FLEET_CLUSTER_COLOR: string;
export const FLEET_CLUSTER_TEXT_COLOR: string;

export interface FleetMarker {
  vanId: string;
  lat: number;
  lng: number;
  ts: number;
  ageMs: number;
  bucket: FleetBucket;
  heading: number | null;
  routeId: string | null;
}

export interface FleetMarkerDetails {
  routeId: string;
  routeName: string;
}

export function fixAgeBucket(ageMs: number): FleetBucket;
export function formatFleetLastSeen(ageMs: number): string;

export function selectFleet(
  locations: VanLocation[] | undefined | null,
  options?: { selfVanId?: string | null; selfDeviceId?: string | null; now?: number },
): FleetMarker[];

export function describeFleetMarker(
  marker: FleetMarker | null | undefined,
  routes: Route[] | undefined | null,
): FleetMarkerDetails | null;
