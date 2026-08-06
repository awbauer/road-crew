import type { LngLat, Route, Sequence } from "@road-crew/contracts";
import { distanceToNextSequenceMiles, fmtMiles } from "@road-crew/core";

export const DEFAULT_CUMBERLAND_FARMS_VISIBLE = false;
export const CUMBERLAND_FARMS_LAYER_ID = "cumbys-farms";

export interface MapLayerControlItem {
  id: string;
  kind: "route" | "cumbys";
  label: string;
  routeId?: string;
}

export function mapLayerControlItems(
  routes: readonly Pick<RouteMapLayer, "id" | "routeId" | "routeName">[],
): MapLayerControlItem[] {
  return [
    ...routes.map((route) => ({
      id: route.id,
      kind: "route" as const,
      label: route.routeName,
      routeId: route.routeId,
    })),
    { id: CUMBERLAND_FARMS_LAYER_ID, kind: "cumbys", label: "Cumbys w/gas" },
  ];
}

/**
 * Preserve map-layer choices while adding/removing routes and always keeping
 * the newly active route visible. Cumbys remains an app-level preference.
 */
export function reconcileMapLayerVisibility(
  previous: Readonly<Record<string, boolean>>,
  routes: readonly Pick<RouteMapLayer, "id" | "routeId">[],
  activeRouteId: string | null,
  cumberlandFarmsVisible: boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> = {
    [CUMBERLAND_FARMS_LAYER_ID]: cumberlandFarmsVisible,
  };
  for (const route of routes) {
    next[route.id] = route.routeId === activeRouteId ? true : previous[route.id] !== false;
  }
  return next;
}

export interface ImperialScaleIndicator {
  label: string;
  width: number;
}

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.280839895;

function niceScaleValue(maximum: number): number {
  if (!Number.isFinite(maximum) || maximum <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return factor * magnitude;
}

/** Mapbox-compatible Web Mercator scale rendered as a compact imperial ruler. */
export function imperialScaleIndicator(
  zoom: number,
  latitude: number,
  maxWidth = 100,
): ImperialScaleIndicator {
  const safeZoom = Number.isFinite(zoom) ? zoom : 0;
  const safeLatitude = Math.max(-85, Math.min(85, Number.isFinite(latitude) ? latitude : 0));
  // Mapbox GL's zoom is one level "ahead" of the classic 256px-tile slippy-map
  // convention this constant assumes, because Mapbox renders 512px tiles at
  // the same z/x/y addressing. Without the +1 here the bar renders correctly
  // but its label reads exactly double the true ground distance.
  const metersPerPixel = 156543.03392 * Math.cos((safeLatitude * Math.PI) / 180) / (2 ** (safeZoom + 1));
  const maximumMeters = Math.max(1, metersPerPixel * Math.max(1, maxWidth));

  if (maximumMeters >= METERS_PER_MILE) {
    const miles = niceScaleValue(maximumMeters / METERS_PER_MILE);
    return {
      label: `${miles.toLocaleString("en-US")} mi`,
      width: Math.max(1, Math.min(maxWidth, (miles * METERS_PER_MILE) / metersPerPixel)),
    };
  }

  const feet = niceScaleValue(maximumMeters * FEET_PER_METER);
  return {
    label: `${feet.toLocaleString("en-US")} ft`,
    width: Math.max(1, Math.min(maxWidth, (feet / FEET_PER_METER) / metersPerPixel)),
  };
}

export interface RouteLayerVisibility {
  labels: boolean;
  path: boolean;
  points: boolean;
}

/**
 * Route toggles control lines and points, but sequence labels always remain
 * exclusive to the active route.
 */
export function routeLayerVisibility(
  routeId: string,
  activeRouteId: string | null,
  routeVisible: boolean,
): RouteLayerVisibility {
  return {
    labels: routeVisible && routeId === activeRouteId,
    path: routeVisible,
    points: routeVisible,
  };
}

export interface CoordinateBounds {
  ne: LngLat;
  sw: LngLat;
}

export interface SequenceMapProperties extends Record<string, unknown> {
  routeId: string;
  routeName: string;
  sequenceIndex: number;
  seq: number;
  // Carried through so the web popup can rehydrate a navigable sequence:
  // navigation targets the GPS point, and the popup only ever sees properties.
  lat: number;
  lng: number;
  street: string;
  town: string;
  dir: string;
  num_first: string | number;
  num_last: string | number;
  cum_miles: string | number;
  distanceToNextLabel: string;
  riderTimesLabel: string;
  intersection: string;
  police: boolean;
  road_crew: boolean;
  mh_sign: boolean;
  water_stop: boolean;
}

export interface SequencePopupDetails {
  distanceToNextLabel: string | null;
  riderTimesLabel: string | null;
}

/** Shared sequence-only details displayed by both map popup adapters. */
export function sequenceMapPopupDetails(
  sequences: Sequence[],
  sequenceIndex: number,
): SequencePopupDetails {
  const sequence = sequences[sequenceIndex];
  if (!sequence) return { distanceToNextLabel: null, riderTimesLabel: null };
  const first = sequence.first_rider_time;
  const last = sequence.last_rider_time;
  const riderTimesLabel = first && last && first !== last
    ? `${first} – ${last}`
    : (first || last) || null;

  return {
    distanceToNextLabel: fmtMiles(distanceToNextSequenceMiles(sequences, sequenceIndex), 2),
    riderTimesLabel,
  };
}

export interface RouteMapSequence {
  coordinate: LngLat;
  properties: SequenceMapProperties;
}

export interface RouteMapLayer {
  coordinates: LngLat[];
  id: string;
  routeId: string;
  routeName: string;
  sequences: RouteMapSequence[];
}

export interface RouteMapModel {
  activeBounds: CoordinateBounds | null;
  activeRouteId: string | null;
  allCoordinates: LngLat[];
  routes: RouteMapLayer[];
}

const EMPTY_MODEL: RouteMapModel = {
  activeBounds: null,
  activeRouteId: null,
  allCoordinates: [],
  routes: [],
};

function isCoordinate(value: unknown): value is LngLat {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function mapLayerId(route: Route, routeIndex: number): string {
  return `rc-route-${routeIndex}-${route.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Returns a valid route line, falling back to ordered sequence coordinates. */
export function routeMapCoordinates(route: Route): LngLat[] {
  if (Array.isArray(route.path) && route.path.length >= 2) {
    const path = route.path.filter(isCoordinate);
    if (path.length >= 2) return path;
  }
  return route.sequences
    .filter((sequence) => Number.isFinite(sequence.lat) && Number.isFinite(sequence.lng))
    .map((sequence) => [sequence.lng as number, sequence.lat as number]);
}

export function coordinateBounds(
  coordinates: readonly LngLat[],
  padding = 0,
): CoordinateBounds | null {
  if (!coordinates.length) return null;
  let minLng = coordinates[0][0];
  let maxLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLat = coordinates[0][1];
  for (const [lng, lat] of coordinates.slice(1)) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return {
    ne: [maxLng + padding, maxLat + padding],
    sw: [minLng - padding, minLat - padding],
  };
}

export function sequenceMapProperties(
  route: Route,
  sequence: Sequence,
  sequenceIndex: number,
): SequenceMapProperties {
  const popupDetails = sequenceMapPopupDetails(route.sequences, sequenceIndex);
  return {
    routeId: route.id,
    routeName: route.name ?? `Route ${route.id}`,
    sequenceIndex,
    seq: sequence.seq,
    lat: sequence.lat as number,
    lng: sequence.lng as number,
    street: sequence.street ?? "",
    town: sequence.town ?? "",
    dir: sequence.dir ?? "",
    num_first: sequence.num_first ?? "",
    num_last: sequence.num_last ?? "",
    cum_miles: sequence.cum_miles ?? "",
    distanceToNextLabel: popupDetails.distanceToNextLabel ?? "",
    riderTimesLabel: popupDetails.riderTimesLabel ?? "",
    intersection: sequence.intersection ?? "",
    police: Boolean(sequence.police),
    road_crew: Boolean(sequence.road_crew),
    mh_sign: Boolean(sequence.mh_sign),
    water_stop: Boolean(sequence.water_stop),
  };
}

export function buildRouteMapModel(
  routes: Route[] | undefined,
  activeId?: string,
): RouteMapModel {
  if (!routes?.length) return EMPTY_MODEL;

  const activeRouteId = routes.find((route) => route.id === activeId)?.id ?? routes[0].id;
  const allCoordinates: LngLat[] = [];
  const layers = routes.map((route, routeIndex): RouteMapLayer => {
    const coordinates = routeMapCoordinates(route);
    const sequences = route.sequences.flatMap((sequence, sequenceIndex): RouteMapSequence[] => {
      if (!Number.isFinite(sequence.lat) || !Number.isFinite(sequence.lng)) return [];
      return [{
        coordinate: [sequence.lng as number, sequence.lat as number],
        properties: sequenceMapProperties(route, sequence, sequenceIndex),
      }];
    });
    allCoordinates.push(...coordinates, ...sequences.map(({ coordinate }) => coordinate));
    return {
      coordinates,
      id: mapLayerId(route, routeIndex),
      routeId: route.id,
      routeName: route.name ?? `Route ${route.id}`,
      sequences,
    };
  });
  const activeLayer = layers.find((route) => route.routeId === activeRouteId);

  return {
    activeBounds: coordinateBounds(activeLayer?.coordinates ?? [], 0.01),
    activeRouteId,
    allCoordinates,
    routes: layers,
  };
}

export function mapSequenceFlags(sequence: Sequence): string[] {
  const flags: string[] = [];
  if (sequence.police) flags.push("Police");
  if (sequence.road_crew) flags.push("Road Crew");
  if (sequence.mh_sign) flags.push("MH Sign");
  if (sequence.water_stop) flags.push("Water Stop");
  return flags;
}

export function sequenceNumberRange(sequence: Sequence): string {
  const first = sequence.num_first == null ? "" : String(sequence.num_first);
  const last = sequence.num_last == null ? "" : String(sequence.num_last);
  if (first && last && first !== last) return `${first}–${last}`;
  return first || last;
}

function propertyText(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function propertyBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function propertyNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Rehydrates the sequence fields needed by a web popup from GeoJSON properties. */
export function sequenceFromMapProperties(properties: Record<string, unknown>): Sequence {
  return {
    seq: propertyNumber(properties.seq) ?? 0,
    lat: propertyNumber(properties.lat),
    lng: propertyNumber(properties.lng),
    street: propertyText(properties.street),
    town: propertyText(properties.town),
    dir: propertyText(properties.dir),
    num_first: propertyText(properties.num_first),
    num_last: propertyText(properties.num_last),
    cum_miles: propertyNumber(properties.cum_miles),
    intersection: propertyText(properties.intersection),
    police: propertyBoolean(properties.police),
    road_crew: propertyBoolean(properties.road_crew),
    mh_sign: propertyBoolean(properties.mh_sign),
    water_stop: propertyBoolean(properties.water_stop),
  };
}
