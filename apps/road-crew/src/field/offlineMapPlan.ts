import type { Route } from "@road-crew/contracts";

export const OFFLINE_TILE_LIMIT = 750;
export const SEQUENCE_TILE_RADIUS_METERS = 250;
export const OFFLINE_PACK_VERSION = 2;
export const OFFLINE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;

export interface SequenceOfflineRegion {
  bounds: { ne: [number, number]; sw: [number, number] };
  index: number;
  name: string;
  sequenceNumber: number;
}

export interface SequenceOfflinePlan {
  key: string;
  regions: SequenceOfflineRegion[];
  routeId: string;
}

function safePackPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function planHash(route: Route): string {
  const source = route.sequences
    .filter((sequence) => Number.isFinite(sequence.lat) && Number.isFinite(sequence.lng))
    .map((sequence) => `${sequence.seq}:${Number(sequence.lat).toFixed(5)},${Number(sequence.lng).toFixed(5)}`)
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function boundsAround(lat: number, lng: number) {
  const latitudeRadius = SEQUENCE_TILE_RADIUS_METERS / 111_320;
  const longitudeRadius = SEQUENCE_TILE_RADIUS_METERS / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return {
    ne: [lng + longitudeRadius, lat + latitudeRadius] as [number, number],
    sw: [lng - longitudeRadius, lat - latitudeRadius] as [number, number],
  };
}

/** Build small, disjoint Mapbox regions around the active route's sequence markers. */
export function buildSequenceOfflinePlan(route: Route | undefined): SequenceOfflinePlan | null {
  if (!route) return null;
  const hash = planHash(route);
  const routeId = safePackPart(route.id);
  const validSequences = route.sequences.filter(
    (sequence) => Number.isFinite(sequence.lat) && Number.isFinite(sequence.lng),
  );
  if (!validSequences.length) return null;

  return {
    key: `${route.id}:${hash}`,
    routeId: route.id,
    regions: validSequences.map((sequence, index) => ({
      bounds: boundsAround(Number(sequence.lat), Number(sequence.lng)),
      index,
      name: `rc-sequence-map-v${OFFLINE_PACK_VERSION}-${routeId}-${hash}-${index.toString(36)}`,
      sequenceNumber: sequence.seq,
    })),
  };
}

export function isRoadCrewOfflinePack(name: string, metadata: unknown): boolean {
  if (name.startsWith("rc-route-map-") || name.startsWith("rc-sequence-map-")) return true;
  return Boolean(metadata && typeof metadata === "object" && "app" in metadata && metadata.app === "road-crew");
}

export function offlineMapRetryDelay(attempt: number): number {
  const index = Math.max(0, Math.min(Math.floor(attempt), OFFLINE_RETRY_DELAYS_MS.length - 1));
  return OFFLINE_RETRY_DELAYS_MS[index];
}

export function isOfflineMapTransientError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return [
    "network",
    "internet",
    "offline",
    "timed out",
    "timeout",
    "connection",
    "temporarily",
    "cancelled",
    "canceled",
  ].some((pattern) => message.includes(pattern));
}
