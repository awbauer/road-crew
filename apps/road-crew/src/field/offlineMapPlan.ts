import type { Route } from "@road-crew/contracts";

export const OFFLINE_TILE_LIMIT = 750;
export const SEQUENCE_TILE_RADIUS_METERS = 250;
export const OFFLINE_PACK_VERSION = 2;
export const OFFLINE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;
export const OFFLINE_MIN_ZOOM = 7;
/** The closest zoom cached when the whole route fits the tile limit. */
export const OFFLINE_MAX_ZOOM = 15;
/** The least detail worth caching around a sequence: still shows the junction. */
export const OFFLINE_FLOOR_MAX_ZOOM = 12;

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
  minZoom: number;
  /**
   * The deepest zoom cached. Lowered for a long route so every sequence gets
   * some coverage inside the tile limit, rather than the first few hundred
   * getting full detail and the rest none (see `fitMaxZoom`).
   */
  maxZoom: number;
  /** Estimated tiles at that zoom range, counted per pack (see `countPackTiles`). */
  estimatedTiles: number;
}

function tileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

function tileY(lat: number, zoom: number): number {
  const rad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom);
}

/**
 * Tiles the packs for these regions hold between the two zooms, counted per
 * pack. Packs that overlap share tiles on disk, but whether the limit counts
 * a shared tile once or per pack is not documented, so this assumes the
 * worse: a plan that fits this count fits the limit either way.
 */
export function countPackTiles(
  regions: Pick<SequenceOfflineRegion, "bounds">[],
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    for (const { bounds } of regions) {
      const columns = tileX(bounds.ne[0], zoom) - tileX(bounds.sw[0], zoom) + 1;
      const rows = tileY(bounds.sw[1], zoom) - tileY(bounds.ne[1], zoom) + 1;
      total += columns * rows;
    }
  }
  return total;
}

/**
 * The deepest zoom whose tiles for the whole route fit the limit, never below
 * `OFFLINE_FLOOR_MAX_ZOOM`. A long route used to stop at the 750-tile limit
 * part-way along with full detail behind it and nothing ahead. A route too
 * long even at the floor still stops at the limit, in route order, and says so.
 */
export function fitMaxZoom(
  regions: Pick<SequenceOfflineRegion, "bounds">[],
  limit = OFFLINE_TILE_LIMIT,
): { maxZoom: number; tiles: number } {
  // A margin for style/glyph resources the pack also counts.
  const budget = Math.floor(limit * 0.9);
  let tiles = 0;
  for (let maxZoom = OFFLINE_MAX_ZOOM; maxZoom >= OFFLINE_FLOOR_MAX_ZOOM; maxZoom -= 1) {
    tiles = countPackTiles(regions, OFFLINE_MIN_ZOOM, maxZoom);
    if (tiles <= budget || maxZoom === OFFLINE_FLOOR_MAX_ZOOM) return { maxZoom, tiles };
  }
  return { maxZoom: OFFLINE_FLOOR_MAX_ZOOM, tiles };
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

  const bounds = validSequences.map((sequence) => boundsAround(Number(sequence.lat), Number(sequence.lng)));
  const { maxZoom, tiles } = fitMaxZoom(bounds.map((item) => ({ bounds: item })));
  // The zoom range is part of the pack name, so a plan that changes it
  // replaces its packs instead of mixing two depths of coverage.
  const depth = maxZoom === OFFLINE_MAX_ZOOM ? "" : `-z${maxZoom}`;
  return {
    key: `${route.id}:${hash}${depth}`,
    routeId: route.id,
    minZoom: OFFLINE_MIN_ZOOM,
    maxZoom,
    estimatedTiles: tiles,
    regions: validSequences.map((sequence, index) => ({
      bounds: bounds[index],
      index,
      name: `rc-sequence-map-v${OFFLINE_PACK_VERSION}-${routeId}-${hash}${depth}-${index.toString(36)}`,
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

/**
 * What a run of the offline-pack check may reset on screen.
 *
 * The check re-runs on every return to the foreground and every reconnect, to
 * resume an interrupted download. Only a *new plan* (another route) is a
 * reason to close open callouts and show the status pill again; a resume used
 * to do both, closing whatever the driver had open and re-showing a pill they
 * had dismissed each time the phone came back to the foreground.
 */
export function offlineCheckResets(previousPlanKey: string | null, planKey: string): {
  closeCallouts: boolean;
  showStatus: boolean;
} {
  const newPlan = previousPlanKey !== planKey;
  return { closeCallouts: newPlan, showStatus: newPlan };
}
