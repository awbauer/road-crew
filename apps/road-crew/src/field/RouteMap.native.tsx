import { type ComponentProps, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Modal } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { FontAwesome6 } from "@expo/vector-icons";
import Mapbox, {
  Camera,
  CircleLayer,
  Images,
  LineLayer,
  MapView,
  MarkerView,
  OfflinePackDownloadState,
  ShapeSource,
  SymbolLayer,
  UserLocation,
  offlineManager,
} from "@rnmapbox/maps";
import { APP_CONFIG, mapProviderById, NEW_MAP_FOLLOW } from "@road-crew/config";
import { clusterCumberlandFarms, cumberlandFarmClusterDistanceForZoom, displayCumberlandFarmStoreNumber, haversine, type CumberlandFarmCluster } from "@road-crew/core";
import { CUMBERLAND_FARMS } from "@road-crew/data";
import { colors } from "@road-crew/ui";
import type { CumberlandFarm, Route, Sequence } from "@road-crew/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addBreadcrumb, captureError, captureMessage } from "@/monitoring";
import { isLikelyTransientError } from "@/lib/errors";
import { isOnline, onConnectivityChange } from "@/sync/network";
import type { NavProvider } from "./Settings.tsx";
import type { RouteMapProps } from "./RouteMap.types.ts";
import {
  describeFleetMarker,
  FLEET_BUCKET_COLOR,
  FLEET_CLUSTER_COLOR,
  FLEET_CLUSTER_TEXT_COLOR,
  formatFleetLastSeen,
  selectFleet,
  type FleetMarker,
  type FleetMarkerDetails,
} from "./fleet.js";
import {
  buildRouteMapModel,
  CUMBERLAND_FARMS_LAYER_ID,
  coordinateBounds,
  DEFAULT_CUMBERLAND_FARMS_VISIBLE,
  imperialScaleIndicator,
  mapLayerControlItems,
  mapSequenceFlags,
  reconcileMapLayerVisibility,
  routeMapCoordinates,
  sequenceMapPopupDetails,
  sequenceNumberRange,
  type MapLayerControlItem,
  type RouteMapModel,
  type SequencePopupDetails,
} from "./mapModel.ts";
import {
  openCumberlandFarmNavigation,
  openFirstAvailableUrl,
  openSequenceNavigation,
} from "./navigationLauncher.ts";
import {
  buildSequenceOfflinePlan,
  isOfflineMapTransientError,
  isRoadCrewOfflinePack,
  offlineMapRetryDelay,
  OFFLINE_PACK_VERSION,
  OFFLINE_TILE_LIMIT,
  SEQUENCE_TILE_RADIUS_METERS,
  type SequenceOfflineRegion,
} from "./offlineMapPlan.ts";
import { FOREGROUND_SETTLE_MS } from "./foregroundLifecycle.ts";
import { useNow } from "@/ui/useNow";

type FeatureCollection = GeoJSON.FeatureCollection;

// Padding used when framing a route to its bounds.
const ROUTE_FRAME_PADDING = { paddingTop: 56, paddingRight: 24, paddingBottom: 56, paddingLeft: 24 };

// The Map tab unmounts whenever the user navigates away and remounts on return
// (see map.tsx), which would otherwise re-frame the route to its bounds every
// time. This module-level store preserves the user's last camera for the JS
// session so the view is restored on remount. It is cleared when the active
// route changes (so a new route re-frames) and resets naturally when the app
// reloads.
type SavedMapCamera = { routeId: string; center: [number, number]; zoom: number };
let savedMapCamera: SavedMapCamera | null = null;

interface NativeRouteData {
  inactiveLines: FeatureCollection;
  activeLines: FeatureCollection;
  inactivePoints: FeatureCollection;
  activePoints: FeatureCollection;
  activeBounds: ReturnType<typeof coordinateBounds>;
  activeRouteId: string | null;
}

interface SelectedMapSequence {
  coordinate: [number, number];
  popupDetails: SequencePopupDetails;
  routeId: string;
  routeName: string;
  sequence: Sequence;
}

interface SelectedMapFarm {
  coordinate: [number, number];
  farm: CumberlandFarm;
}

interface SelectedMapFarmCluster {
  coordinate: [number, number];
  cluster: CumberlandFarmCluster;
}

interface SelectedMapVan {
  coordinate: [number, number];
  marker: FleetMarker;
  details: FleetMarkerDetails | null;
}

const EMPTY_DATA: NativeRouteData = {
  inactiveLines: { type: "FeatureCollection", features: [] },
  activeLines: { type: "FeatureCollection", features: [] },
  inactivePoints: { type: "FeatureCollection", features: [] },
  activePoints: { type: "FeatureCollection", features: [] },
  activeBounds: null,
  activeRouteId: null,
};

// Set this before the first MapView mounts. Doing it in an effect causes the
// native style to initialize once without a token and then reload immediately.
Mapbox.setAccessToken(APP_CONFIG.mapboxToken).catch(() => {});

// RNMapbox's iOS limit setter owns a thread-affine native object. Configure it
// once per JS runtime; repeating this call during a route change is unsafe.
const mapboxRuntime = globalThis as typeof globalThis & { __rcOfflineTileLimitConfigured?: boolean };
if (!mapboxRuntime.__rcOfflineTileLimitConfigured) {
  offlineManager.setTileCountLimit(OFFLINE_TILE_LIMIT);
  mapboxRuntime.__rcOfflineTileLimitConfigured = true;
}

// The van silhouette Command's Crew Vans map uses (Font Awesome van-shuttle),
// rasterized to a white-on-transparent PNG shared with the web adapter.
// Registered `sdf` so `iconColor` can tint one asset per freshness bucket,
// exactly as the circles this replaced were tinted.
const VAN_MARKER_IMAGE = require("../../public/icons/van-marker.png") as number;
const VAN_MARKER_IMAGE_ID = "rc-van-marker";
// Scales the 96px source so the silhouette lands at roughly the 24px glyph
// Command draws.
const VAN_MARKER_ICON_SIZE = 0.38;
// A slightly larger copy of the same silhouette sits behind the tinted van.
// Unlike an SDF halo on this raster asset, it follows the van contour instead
// of expanding the icon's rectangular image quad.
const VAN_MARKER_OUTLINE_ICON_SIZE = 0.44;
const VAN_MARKER_OUTLINE_COLOR = "#fff";
// Read at arm's length in a moving van, over a light basemap, so the van ID is
// larger and bolder than the 10px it started at, with a halo heavy enough to
// carry it over road casings.
const VAN_MARKER_LABEL_SIZE = 13;
const VAN_MARKER_LABEL_HALO_WIDTH = 2;
// Mapbox resolves these against the style's glyph endpoint; the second is the
// conventional fallback if the first is unavailable for a glyph.
const VAN_MARKER_LABEL_FONT = ["Open Sans Bold", "Arial Unicode MS Bold"];
// Label gap below the marker, in ems of the label size. Kept in step with the
// web adapter.
const VAN_MARKER_LABEL_OFFSET_EM = 1.45;

const FARM_BLUE = colors.blue;
const GAS_ICON_OUTLINE_OFFSETS = [
  [-3, 0], [3, 0], [0, -3], [0, 3],
  [-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1],
] as const;

function featureCollection(features: GeoJSON.Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

function pointFeature(coordinates: [number, number], properties: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates },
  };
}

function buildRouteData(
  model: RouteMapModel,
  visibility: Readonly<Record<string, boolean>>,
): NativeRouteData {
  if (!model.routes.length) return EMPTY_DATA;
  const inactiveLines: GeoJSON.Feature[] = [];
  const activeLines: GeoJSON.Feature[] = [];
  const inactivePoints: GeoJSON.Feature[] = [];
  const activePoints: GeoJSON.Feature[] = [];

  for (const route of model.routes) {
    if (visibility[route.id] === false) continue;
    const isActive = route.routeId === model.activeRouteId;
    if (route.coordinates.length >= 2) {
      const line: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: { routeId: route.routeId, routeName: route.routeName },
        geometry: { type: "LineString", coordinates: route.coordinates },
      };
      (isActive ? activeLines : inactiveLines).push(line);
    }
    for (const sequence of route.sequences) {
      (isActive ? activePoints : inactivePoints).push(
        pointFeature(sequence.coordinate, sequence.properties),
      );
    }
  }

  return {
    inactiveLines: featureCollection(inactiveLines),
    activeLines: featureCollection(activeLines),
    inactivePoints: featureCollection(inactivePoints),
    activePoints: featureCollection(activePoints),
    activeBounds: model.activeBounds,
    activeRouteId: model.activeRouteId,
  };
}

function OfflineMapStatus({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.statusWrap}>
      <View style={styles.statusPill}>
        <Text style={styles.statusText}>{message}</Text>
      </View>
    </View>
  );
}

const openUrl = (url: string) => Linking.openURL(url);

function StoreCallout({
  selected,
  navProvider,
  onClose,
}: {
  selected: SelectedMapFarm;
  navProvider: NavProvider;
  onClose: () => void;
}) {
  const { farm } = selected;
  const openNavigation = async () => {
    await openCumberlandFarmNavigation(openUrl, farm, navProvider);
  };
  const openStorePage = async () => {
    await openFirstAvailableUrl(openUrl, [farm.source]);
  };

  return (
    <View style={styles.calloutWrap}>
      <View style={styles.callout}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close Cumberland Farms details"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.calloutClose, pressed && styles.calloutClosePressed]}
        >
          <Text style={styles.calloutCloseText}>×</Text>
        </Pressable>
        <Text style={styles.calloutHead}>{farm.name}</Text>
        <Text style={styles.calloutTitle}>{farm.address}</Text>
        <Text style={styles.calloutRoute}>{farm.city}, {farm.state} {farm.zip}</Text>
        <View style={styles.calloutRow}><Text style={styles.calloutKey}>Store</Text><Text style={styles.calloutValue}>#{displayCumberlandFarmStoreNumber(farm.storeNumber)}</Text></View>
        {farm.phone ? <View style={styles.calloutRow}><Text style={styles.calloutKey}>Phone</Text><Text style={styles.calloutValue}>{farm.phone}</Text></View> : null}
        {farm.hours ? <View style={styles.calloutRow}><Text style={styles.calloutKey}>Hours</Text><Text style={styles.calloutValue}>{farm.hours}</Text></View> : null}
        {farm.source ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open Cumberland Farms store details"
            onPress={(event) => {
              event.stopPropagation();
              void openStorePage();
            }}
            style={({ pressed }) => [styles.calloutStoreLink, pressed && styles.calloutNavButtonPressed]}
          >
            <Text style={styles.calloutStoreLinkText}>Store details</Text>
          </Pressable>
        ) : null}
        <View style={styles.calloutNavRow}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Navigate to Cumberland Farms"
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              void openNavigation();
            }}
            style={({ pressed }) => [styles.calloutFarmButton, pressed && styles.calloutNavButtonPressed]}
          >
            <FontAwesome6 name="diamond-turn-right" size={16} color="#fff" />
          </Pressable>
        </View>
      </View>
      <View style={styles.calloutTip} />
    </View>
  );
}

function StoreClusterCallout({
  selected,
  navProvider,
  onClose,
}: {
  selected: SelectedMapFarmCluster;
  navProvider: NavProvider;
  onClose: () => void;
}) {
  const openNavigation = async (farm: CumberlandFarm) => {
    await openCumberlandFarmNavigation(openUrl, farm, navProvider);
  };
  const openStorePage = async (farm: CumberlandFarm) => {
    await openFirstAvailableUrl(openUrl, [farm.source]);
  };

  return (
    <View style={styles.calloutWrap}>
      <View style={styles.callout}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close Cumberland Farms group details"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.calloutClose, pressed && styles.calloutClosePressed]}
        >
          <Text style={styles.calloutCloseText}>×</Text>
        </Pressable>
        <Text style={styles.calloutHead}>CUMBERLAND FARMS · {selected.cluster.farms.length} NEARBY</Text>
        {selected.cluster.farms.map((farm) => (
          <View key={farm.id} style={styles.calloutClusterRow}>
            <Text style={styles.calloutFarmAddress}>#{displayCumberlandFarmStoreNumber(farm.storeNumber)} · {farm.address}</Text>
            <Text style={styles.calloutRoute}>{farm.city}, {farm.state} {farm.zip}</Text>
            {farm.hours ? <Text style={styles.calloutRoute}>Hours: {farm.hours}</Text> : null}
            {farm.source ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open Cumberland Farms store details for ${farm.address}`}
                onPress={(event) => {
                  event.stopPropagation();
                  void openStorePage(farm);
                }}
                style={({ pressed }) => [styles.calloutStoreLink, pressed && styles.calloutNavButtonPressed]}
              >
                <Text style={styles.calloutStoreLinkText}>Store details</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Navigate to Cumberland Farms ${farm.address}`}
              hitSlop={8}
              onPress={(event) => {
                event.stopPropagation();
                void openNavigation(farm);
              }}
              style={({ pressed }) => [styles.calloutFarmButton, styles.calloutClusterNavButton, pressed && styles.calloutNavButtonPressed]}
            >
              <FontAwesome6 name="diamond-turn-right" size={13} color="#fff" />
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.calloutTip} />
    </View>
  );
}

function VanCallout({
  selected,
  onClose,
}: {
  selected: SelectedMapVan;
  onClose: () => void;
}) {
  const { details, marker } = selected;
  const rows = [
    ["Route", details?.routeName ?? "Unavailable"],
    ["Last seen", formatFleetLastSeen(marker.ageMs)],
  ];

  return (
    <View style={styles.calloutWrap}>
      <View style={styles.callout}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close van details"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.calloutClose, pressed && styles.calloutClosePressed]}
        >
          <Text style={styles.calloutCloseText}>×</Text>
        </Pressable>
        <Text style={[styles.calloutHead, styles.calloutHeadFleet]}>{marker.vanId}</Text>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.calloutRow}>
            <Text style={styles.calloutKey}>{label}</Text>
            <Text style={styles.calloutValue}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={styles.calloutTip} />
    </View>
  );
}

function SequenceCallout({
  selected,
  navProvider,
  onClose,
}: {
  selected: SelectedMapSequence;
  navProvider: NavProvider;
  onClose: () => void;
}) {
  const { popupDetails, routeName, sequence } = selected;
  const flags = mapSequenceFlags(sequence);
  const rows = [
    ["Dir", sequence.dir ?? ""],
    ["Nums", sequenceNumberRange(sequence)],
    ["Cum mi", sequence.cum_miles == null ? "" : String(sequence.cum_miles)],
    ["Dist next", popupDetails.distanceToNextLabel ?? ""],
    ["Riders", popupDetails.riderTimesLabel ?? ""],
    ["Int", sequence.intersection ?? ""],
  ].filter((row) => row[1]);

  const openNavigation = async () => {
    await openSequenceNavigation(openUrl, sequence, navProvider);
  };

  return (
    <View style={styles.calloutWrap}>
      <View style={styles.callout}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sequence details"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.calloutClose, pressed && styles.calloutClosePressed]}
        >
          <Text style={styles.calloutCloseText}>×</Text>
        </Pressable>
        <Text style={styles.calloutHead}>SEQ #{sequence.seq} · {sequence.town || "—"}</Text>
        <Text style={styles.calloutTitle}>{sequence.street || "—"}</Text>
        {routeName ? <Text style={styles.calloutRoute}>{routeName}</Text> : null}
        {rows.map(([label, value]) => (
          <View key={label} style={styles.calloutRow}>
            <Text style={styles.calloutKey}>{label}</Text>
            <Text style={styles.calloutValue}>{value}</Text>
          </View>
        ))}
        {flags.length ? (
          <View style={styles.calloutFlags}>
            {flags.map((flag) => <Text key={flag} style={styles.calloutFlag}>{flag}</Text>)}
          </View>
        ) : null}
        <View style={styles.calloutNavRow}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Navigate to this sequence"
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              void openNavigation();
            }}
            style={({ pressed }) => [styles.calloutNavButton, pressed && styles.calloutNavButtonPressed]}
          >
            <FontAwesome6 name="diamond-turn-right" size={16} color="#fff" />
          </Pressable>
        </View>
      </View>
      <View style={styles.calloutTip} />
    </View>
  );
}

type OfflinePackHandle = NonNullable<Awaited<ReturnType<typeof offlineManager.getPack>>>;
type OfflineProgress = Awaited<ReturnType<OfflinePackHandle["status"]>>;

class OfflineDownloadCancelledError extends Error {
  constructor() {
    super("Offline map download cancelled");
    this.name = "OfflineDownloadCancelledError";
  }
}

function isComplete(status: OfflineProgress): boolean {
  return status.state === OfflinePackDownloadState.Complete || status.percentage >= 100;
}

function offlineError(error: { message?: string; name?: string } | null | undefined): Error {
  return new Error(error?.message || error?.name || "Unknown Mapbox offline error");
}

async function waitForExistingPack(
  pack: OfflinePackHandle,
  signal: AbortSignal,
  onProgress: (status: OfflineProgress) => void,
): Promise<void> {
  const status = await pack.status();
  if (isComplete(status)) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) offlineManager.unsubscribe(pack.name);
      error ? reject(error) : resolve();
    };
    const onAbort = () => finish(new OfflineDownloadCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();

    void offlineManager
      .subscribe(
        pack.name,
        (_pack, progress) => {
          onProgress(progress);
          if (isComplete(progress)) finish();
        },
        (_pack, error) => finish(offlineError(error)),
      )
      .then(() => pack.resume())
      .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

async function createSequencePack(
  routeId: string,
  region: SequenceOfflineRegion,
  signal: AbortSignal,
  onProgress: (status: OfflineProgress) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) offlineManager.unsubscribe(region.name);
      error ? reject(error) : resolve();
    };
    const onAbort = () => finish(new OfflineDownloadCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();

    void offlineManager
      .createPack(
        {
          name: region.name,
          styleURL: APP_CONFIG.mapboxStyle,
          bounds: [region.bounds.ne, region.bounds.sw],
          minZoom: 7,
          maxZoom: 15,
          metadata: {
            app: "road-crew",
            version: OFFLINE_PACK_VERSION,
            routeId,
            sequenceIndex: region.index,
            sequenceNumber: region.sequenceNumber,
            radiusMeters: SEQUENCE_TILE_RADIUS_METERS,
          },
        },
        (_pack, progress) => {
          onProgress(progress);
          if (isComplete(progress)) finish();
        },
        (_pack, error) => finish(offlineError(error)),
      )
      .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

function NativeMapboxRouteMap({
  routes,
  activeId,
  nextSeqNum,
  initialSequenceNumber = null,
  onInitialSequenceOpened,
  cumberlandFarmsVisible = DEFAULT_CUMBERLAND_FARMS_VISIBLE,
  onCumberlandFarmsVisibleChange,
  navProvider = "apple",
  vans,
  selfVanId,
  follow = false,
  onFollowChange,
}: RouteMapProps) {
  // Fleet ages are minute-granularity labels. Re-evaluate from the raw server
  // timestamp even when polling is offline, without churning Mapbox each second.
  const fleetNowMs = useNow(true, 30_000);
  const [offlineStatus, setOfflineStatus] = useState<string | null>(null);
  const [offlineRetryToken, setOfflineRetryToken] = useState(0);
  const [selectedSequence, setSelectedSequence] = useState<SelectedMapSequence | null>(null);
  const [selectedFarm, setSelectedFarm] = useState<SelectedMapFarm | null>(null);
  const [selectedFarmCluster, setSelectedFarmCluster] = useState<SelectedMapFarmCluster | null>(null);
  const [selectedVan, setSelectedVan] = useState<SelectedMapVan | null>(null);
  const [showCumberlandFarms, setShowCumberlandFarms] = useState(cumberlandFarmsVisible);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [farmZoom, setFarmZoom] = useState(6.4);
  const [cameraState, setCameraState] = useState({ zoom: 6.4, latitude: 41.9 });
  const [mapReady, setMapReady] = useState(false);
  const foregroundActiveRef = useRef(AppState.currentState === "active");
  const offlineStatusDismissedRef = useRef(false);
  const safeInsets = useSafeAreaInsets();
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foregroundRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineAbortRef = useRef<AbortController | null>(null);
  const planKeyRef = useRef<string | null>(null);
  const cameraRef = useRef<any>(null);
  const userCoordinateRef = useRef<[number, number] | null>(null);
  // When we last moved the camera ourselves, so our own re-centre is not
  // mistaken for the user panning away.
  const selfCameraMoveAtRef = useRef(0);
  const followRef = useRef(NEW_MAP_FOLLOW && follow);
  followRef.current = NEW_MAP_FOLLOW && follow;
  const onFollowChangeRef = useRef(onFollowChange);
  onFollowChangeRef.current = onFollowChange;

  /**
   * Put the driver in the centre of the screen without touching zoom.
   *
   * setCamera with only a centerCoordinate is deliberate. The SDK's own follow
   * mode (followUserLocation) applies its own zoom when it engages and on
   * re-engage, which is the behaviour this has to avoid: a driver who zoomed
   * out to see the road ahead must keep that zoom.
   */
  const centerOnUser = useCallback(() => {
    if (!foregroundActiveRef.current) return;
    const coordinate = userCoordinateRef.current;
    if (!coordinate) return;
    selfCameraMoveAtRef.current = Date.now();
    cameraRef.current?.setCamera({ centerCoordinate: coordinate, animationDuration: 300 });
  }, []);

  useEffect(() => {
    if (NEW_MAP_FOLLOW && follow) centerOnUser();
  }, [follow, centerOnUser]);
  const fleetSourceRef = useRef<any>(null);
  const reportedJumpKeyRef = useRef<string | null>(null);
  const fleet = useMemo(() => selectFleet(vans, { selfVanId, now: fleetNowMs }), [fleetNowMs, vans, selfVanId]);
  const farmClusters = useMemo(
    () => clusterCumberlandFarms(CUMBERLAND_FARMS, cumberlandFarmClusterDistanceForZoom(farmZoom)),
    [farmZoom],
  );
  const routeModel = useMemo(() => buildRouteMapModel(routes, activeId), [routes, activeId]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    [CUMBERLAND_FARMS_LAYER_ID]: cumberlandFarmsVisible,
  });
  const routeData = useMemo(
    () => buildRouteData(routeModel, layerVisibility),
    [layerVisibility, routeModel],
  );
  const layerItems = useMemo(() => mapLayerControlItems(routeModel.routes), [routeModel.routes]);
  const scaleIndicator = useMemo(
    () => imperialScaleIndicator(cameraState.zoom, cameraState.latitude, 96),
    [cameraState.zoom, cameraState.latitude],
  );
  const activeRoute = useMemo(
    () => routes?.find((route) => route.id === routeData.activeRouteId),
    [routes, routeData.activeRouteId],
  );
  const jumpSequence = useMemo(() => {
    if (!Number.isInteger(initialSequenceNumber) || initialSequenceNumber == null) return null;
    const sequenceIndex = activeRoute?.sequences.findIndex((item) => item.seq === initialSequenceNumber) ?? -1;
    const sequence = sequenceIndex >= 0 ? activeRoute?.sequences[sequenceIndex] : undefined;
    if (!activeRoute || !sequence || !Number.isFinite(sequence.lat) || !Number.isFinite(sequence.lng)) return null;
    return { route: activeRoute, sequence, sequenceIndex };
  }, [activeRoute, initialSequenceNumber]);
  const [cameraJump, setCameraJump] = useState(jumpSequence);
  const cameraRouteIdRef = useRef(routeData.activeRouteId);
  // Frame the route on first open, but restore the user's saved view on
  // remount (e.g. returning to the Map tab). Computed once at mount.
  const initialCameraRef = useRef<ComponentProps<typeof Camera>["defaultSettings"]>(
    savedMapCamera && savedMapCamera.routeId === routeData.activeRouteId
      ? { centerCoordinate: savedMapCamera.center, zoomLevel: savedMapCamera.zoom }
      : routeData.activeBounds
        ? { bounds: routeData.activeBounds, padding: ROUTE_FRAME_PADDING }
        : undefined,
  );
  const offlinePlan = useMemo(() => buildSequenceOfflinePlan(activeRoute), [activeRoute]);
  const fleetData = useMemo(
    () => featureCollection(fleet.map((van) => pointFeature([van.lng, van.lat], {
      vanId: van.vanId,
      bucket: van.bucket,
    }))),
    [fleet],
  );
  const farmData = useMemo(
    () => featureCollection(farmClusters
      .filter((cluster) => cluster.farms.length > 1)
      .map((cluster) => pointFeature([cluster.lng, cluster.lat], {
      clusterId: cluster.id,
      storeCount: cluster.farms.length,
      label: String(cluster.farms.length),
    }))),
    [farmClusters],
  );
  const standaloneFarms = useMemo(
    () => farmClusters.flatMap((cluster) => cluster.farms.length === 1 ? cluster.farms : []),
    [farmClusters],
  );

  useEffect(() => {
    setShowCumberlandFarms(cumberlandFarmsVisible);
    setLayerVisibility((previous) => (
      previous[CUMBERLAND_FARMS_LAYER_ID] === cumberlandFarmsVisible
        ? previous
        : { ...previous, [CUMBERLAND_FARMS_LAYER_ID]: cumberlandFarmsVisible }
    ));
  }, [cumberlandFarmsVisible]);

  useEffect(() => {
    setLayerVisibility((previous) => reconcileMapLayerVisibility(
      previous,
      routeModel.routes,
      routeModel.activeRouteId,
      cumberlandFarmsVisible,
    ));
  }, [routeModel.activeRouteId, routeModel.routes]);

  useEffect(() => {
    if (initialSequenceNumber == null) reportedJumpKeyRef.current = null;
  }, [initialSequenceNumber]);

  useEffect(() => {
    if (cameraRouteIdRef.current === routeData.activeRouteId) return;
    cameraRouteIdRef.current = routeData.activeRouteId;
    setCameraJump(null);
    setSelectedSequence(null);
    // A new route re-frames to its bounds and discards the previous saved view.
    savedMapCamera = null;
    if (routeData.activeBounds) {
      cameraRef.current?.setCamera({
        bounds: routeData.activeBounds,
        padding: ROUTE_FRAME_PADDING,
        animationDuration: 500,
      });
    }
    // routeData.activeBounds is derived from activeRouteId, so it is current here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeData.activeRouteId]);

  useEffect(() => {
    setSelectedVan((previous) => {
      if (!previous) return null;
      const marker = fleet.find((item) => item.vanId === previous.marker.vanId);
      if (!marker) return null;
      return {
        coordinate: [marker.lng, marker.lat],
        marker,
        details: describeFleetMarker(marker, routes),
      };
    });
  }, [fleet, routes]);

  const dismissOfflineStatus = () => {
    offlineStatusDismissedRef.current = true;
    setOfflineStatus(null);
  };

  const requestOfflineRetry = () => {
    if (!foregroundActiveRef.current) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setOfflineRetryToken((value) => value + 1);
  };

  useEffect(() => {
    let previousOnline: boolean | null = null;
    const unsubscribe = onConnectivityChange((online) => {
      if (online && previousOnline === false && foregroundActiveRef.current) requestOfflineRetry();
      previousOnline = online;
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      foregroundActiveRef.current = state === "active";
      if (foregroundRetryTimerRef.current) {
        clearTimeout(foregroundRetryTimerRef.current);
        foregroundRetryTimerRef.current = null;
      }
      if (foregroundActiveRef.current) {
        foregroundRetryTimerRef.current = setTimeout(() => {
          foregroundRetryTimerRef.current = null;
          requestOfflineRetry();
        }, FOREGROUND_SETTLE_MS);
      } else {
        // Do not let an offline-pack callback update the Mapbox/Fabric tree
        // while iOS is snapshotting or backgrounding the current surface.
        offlineAbortRef.current?.abort();
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      }
    });
    return () => {
      unsubscribe();
      appStateSubscription.remove();
      if (foregroundRetryTimerRef.current) clearTimeout(foregroundRetryTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const selectSequence = (event: Parameters<NonNullable<React.ComponentProps<typeof ShapeSource>["onPress"]>>[0]) => {
    const feature = event.features.find((item) => item.geometry.type === "Point");
    const properties = feature?.properties;
    if (!feature || feature.geometry.type !== "Point" || !properties) return;
    const route = routes?.find((item) => item.id === String(properties.routeId));
    const sequenceIndex = Number(properties.sequenceIndex);
    const sequence = Number.isInteger(sequenceIndex) ? route?.sequences[sequenceIndex] : undefined;
    if (!route || !sequence || !Number.isFinite(sequence.lat) || !Number.isFinite(sequence.lng)) return;
    dismissOfflineStatus();
    setSelectedFarm(null);
    setSelectedFarmCluster(null);
    setSelectedVan(null);
    setSelectedSequence({
      coordinate: [sequence.lng as number, sequence.lat as number],
      popupDetails: sequenceMapPopupDetails(route.sequences, sequenceIndex),
      routeId: route.id,
      routeName: route.name ?? "",
      sequence,
    });
  };

  const selectFarm = (farm: CumberlandFarm) => {
    dismissOfflineStatus();
    setSelectedSequence(null);
    setSelectedFarmCluster(null);
    setSelectedVan(null);
    setSelectedFarm({ farm, coordinate: [farm.lng, farm.lat] });
  };

  const selectFarmCluster = (cluster: CumberlandFarmCluster) => {
    dismissOfflineStatus();
    setSelectedSequence(null);
    setSelectedFarm(null);
    setSelectedVan(null);
    if (cluster.farms.length === 1) selectFarm(cluster.farms[0]);
    else setSelectedFarmCluster({ cluster, coordinate: [cluster.lng, cluster.lat] });
  };

  const selectFarmLayer = (event: Parameters<NonNullable<React.ComponentProps<typeof ShapeSource>["onPress"]>>[0]) => {
    const feature = event.features.find((item) => item.geometry.type === "Point");
    const clusterId = feature?.properties?.clusterId;
    if (clusterId == null) return;
    const cluster = farmClusters.find((item) => item.id === String(clusterId));
    if (cluster) selectFarmCluster(cluster);
  };

  const selectFleetLayer = async (event: Parameters<NonNullable<React.ComponentProps<typeof ShapeSource>["onPress"]>>[0]) => {
    const feature = event.features.find((item) => item.geometry.type === "Point");
    if (!feature || feature.geometry.type !== "Point") return;
    const coordinate = feature.geometry.coordinates as [number, number];
    if (feature.properties?.cluster === true || Number(feature.properties?.point_count) > 1) {
      dismissOfflineStatus();
      setSelectedVan(null);
      try {
        const zoom = await fleetSourceRef.current?.getClusterExpansionZoom(feature);
        if (Number.isFinite(zoom)) {
          cameraRef.current?.setCamera({
            centerCoordinate: coordinate,
            zoomLevel: zoom,
            animationDuration: 250,
          });
        }
      } catch (error) {
        captureError(error, { tags: { source: "fleet_cluster_expand" } });
      }
      return;
    }
    const marker = fleet.find((item) => item.vanId === String(feature.properties?.vanId));
    if (!marker) return;
    dismissOfflineStatus();
    setSelectedSequence(null);
    setSelectedFarm(null);
    setSelectedFarmCluster(null);
    setSelectedVan({
      coordinate: [marker.lng, marker.lat],
      marker,
      details: describeFleetMarker(marker, routes),
    });
  };

  useEffect(() => {
    if (!foregroundActiveRef.current) return;
    if (!offlinePlan) {
      setOfflineStatus("Route coordinates are not available.");
      return;
    }

    if (planKeyRef.current !== offlinePlan.key) {
      planKeyRef.current = offlinePlan.key;
      retryAttemptRef.current = 0;
    }

    const abortController = new AbortController();
    offlineAbortRef.current = abortController;
    const { routeId, regions } = offlinePlan;
    const desiredNames = new Set(regions.map((region) => region.name));
    let currentRegion: SequenceOfflineRegion | null = null;
    let completedRegions = 0;
    offlineStatusDismissedRef.current = false;
    setSelectedSequence(null);
    setSelectedFarm(null);
    setSelectedFarmCluster(null);
    setSelectedVan(null);
    setOfflineStatus("Checking offline map…");

    const canUpdateMapState = () => (
      !abortController.signal.aborted && foregroundActiveRef.current
    );

    const showStatus = (message: string) => {
      if (canUpdateMapState() && !offlineStatusDismissedRef.current) setOfflineStatus(message);
    };

    const setProgress = (packPercentage: number) => {
      if (!canUpdateMapState()) return;
      const overall = Math.round(((completedRegions + packPercentage / 100) / regions.length) * 100);
      showStatus(`Downloading offline map near route sequences… ${overall}%`);
    };

    async function prepareOfflinePacks() {
      try {
        const packs = await offlineManager.getPacks();
        const existingByName = new Map(
          packs.map((pack) => [pack.name, pack] as const),
        );
        const readyNames = new Set<string>();
        for (const region of regions) {
          const existing = existingByName.get(region.name);
          if (existing && isComplete(await existing.status())) readyNames.add(region.name);
        }
        completedRegions = readyNames.size;
        if (completedRegions === regions.length) {
          if (canUpdateMapState()) setOfflineStatus(null);
          return;
        }

        // Preserve the previous route's packs if a route is changed while the
        // device is offline. Cleanup starts only after reachability is known.
        if (!(await isOnline())) {
          if (!abortController.signal.aborted) {
            showStatus(`Offline — map cached near ${completedRegions} of ${regions.length} route sequences`);
          }
          return;
        }

        for (const pack of packs) {
          if (abortController.signal.aborted) throw new OfflineDownloadCancelledError();
          if (isRoadCrewOfflinePack(pack.name, pack.metadata) && !desiredNames.has(pack.name)) {
            offlineManager.unsubscribe(pack.name);
            await offlineManager.deletePack(pack.name);
          }
        }

        setProgress(0);
        let downloadedOrUpdated = false;
        for (const region of regions) {
          if (abortController.signal.aborted) throw new OfflineDownloadCancelledError();
          if (readyNames.has(region.name)) continue;
          currentRegion = region;
          const existing = await offlineManager.getPack(region.name);
          if (existing) {
            downloadedOrUpdated = true;
            await waitForExistingPack(existing, abortController.signal, (status) => setProgress(status.percentage));
          } else {
            downloadedOrUpdated = true;
            await createSequencePack(routeId, region, abortController.signal, (status) => setProgress(status.percentage));
          }
          completedRegions += 1;
          retryAttemptRef.current = 0;
          setProgress(0);
        }
        if (!abortController.signal.aborted && downloadedOrUpdated) {
          retryAttemptRef.current = 0;
          showStatus("Offline map ready near all route sequences");
          addBreadcrumb("mapbox sequence offline plan ready", {
            routeId,
            regionCount: regions.length,
            tileLimit: OFFLINE_TILE_LIMIT,
          });
        }
      } catch (error) {
        if (error instanceof OfflineDownloadCancelledError || abortController.signal.aborted) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        const hitTileLimit = /tile.*(limit|maximum|max)|beyond the maximum|allowed 750/i.test(normalized.message);
        if (hitTileLimit) {
          showStatus(`Offline map cached near ${completedRegions} of ${regions.length} route sequences (750-tile limit reached)`);
          addBreadcrumb("mapbox offline tile limit reached", {
            routeId,
            completedRegions,
            regionCount: regions.length,
            sequenceNumber: currentRegion?.sequenceNumber ?? null,
          });
          captureMessage(`Mapbox offline coverage stopped at the ${OFFLINE_TILE_LIMIT}-tile limit`, "warning");
          return;
        }
        if (isLikelyTransientError(normalized) || isOfflineMapTransientError(normalized)) {
          const delayMs = offlineMapRetryDelay(retryAttemptRef.current);
          retryAttemptRef.current += 1;
          showStatus(`Offline map download paused; retrying in ${Math.round(delayMs / 1000)}s`);
          addBreadcrumb("mapbox offline download paused", {
            routeId,
            completedRegions,
            regionCount: regions.length,
            sequenceNumber: currentRegion?.sequenceNumber ?? null,
            retryInMs: delayMs,
            error: normalized.message,
          });
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (foregroundActiveRef.current) setOfflineRetryToken((value) => value + 1);
          }, delayMs);
          return;
        }
        showStatus("Offline map unavailable; route lines remain available");
        captureError(error, {
          tags: { source: "mapbox_offline_pack" },
          extra: {
            routeId,
            packName: currentRegion?.name ?? null,
            sequenceNumber: currentRegion?.sequenceNumber ?? null,
            styleURL: APP_CONFIG.mapboxStyle,
            bounds: currentRegion?.bounds ?? null,
            minZoom: 7,
            maxZoom: 15,
            tileLimit: OFFLINE_TILE_LIMIT,
            completedRegions,
            regionCount: regions.length,
          },
        });
      }
    }

    void prepareOfflinePacks();
    return () => {
      abortController.abort();
      if (offlineAbortRef.current === abortController) offlineAbortRef.current = null;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      for (const region of regions) offlineManager.unsubscribe(region.name);
    };
  }, [offlinePlan, offlineRetryToken]);

  useEffect(() => {
    if (!jumpSequence) return;
    dismissOfflineStatus();
    setCameraJump(jumpSequence);
    setSelectedSequence({
      coordinate: [jumpSequence.sequence.lng as number, jumpSequence.sequence.lat as number],
      popupDetails: sequenceMapPopupDetails(jumpSequence.route.sequences, jumpSequence.sequenceIndex),
      routeId: jumpSequence.route.id,
      routeName: jumpSequence.route.name ?? "",
      sequence: jumpSequence.sequence,
    });
  }, [jumpSequence]);

  useEffect(() => {
    if (!mapReady || !cameraJump || !selectedSequence) return;
    const jumpKey = `${cameraJump.route.id}:${cameraJump.sequence.seq}`;
    if (
      reportedJumpKeyRef.current === jumpKey
      || selectedSequence.sequence.seq !== cameraJump.sequence.seq
    ) {
      return;
    }
    reportedJumpKeyRef.current = jumpKey;
    onInitialSequenceOpened?.();
  }, [cameraJump, mapReady, onInitialSequenceOpened, selectedSequence]);

  const toggleLayer = (item: MapLayerControlItem) => {
    if (item.kind === "cumbys") {
      const next = !showCumberlandFarms;
      if (!next) {
        setSelectedFarm(null);
        setSelectedFarmCluster(null);
      }
      setShowCumberlandFarms(next);
      setLayerVisibility((previous) => ({ ...previous, [CUMBERLAND_FARMS_LAYER_ID]: next }));
      onCumberlandFarmsVisibleChange?.(next);
      return;
    }

    const next = layerVisibility[item.id] === false;
    setLayerVisibility((previous) => ({ ...previous, [item.id]: next }));
    if (!next && selectedSequence?.routeId === item.routeId) setSelectedSequence(null);
  };

  const locateUser = () => {
    const coordinate = userCoordinateRef.current;
    if (!coordinate) return;
    dismissOfflineStatus();
    setLayerMenuOpen(false);
    cameraRef.current?.setCamera({
      centerCoordinate: coordinate,
      zoomLevel: Math.max(cameraState.zoom, 14),
      animationDuration: 300,
    });
  };

  // Bottom-left stack, from the map edge up: layers button, then (when open)
  // the layer menu, then the legacy locate button while map follow is disabled.
  const controlBottomBase = Math.max(12, safeInsets.bottom + 8);
  const locateButtonBottom = controlBottomBase + 40;
  const layerMenuBottom = controlBottomBase + (NEW_MAP_FOLLOW ? 40 : 80);

  const mapContent = (
    <View style={styles.mapCanvas}>
      <MapView
        style={styles.map}
        styleURL={APP_CONFIG.mapboxStyle}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled
        compassFadeWhenNorth={false}
        compassPosition={{ top: isFullscreen ? Math.max(32, safeInsets.top + 12) : 12, right: 12 }}
        scaleBarEnabled={false}
        onDidFinishLoadingMap={() => {
          if (foregroundActiveRef.current) setMapReady(true);
        }}
        onPress={() => {
          if (!foregroundActiveRef.current) return;
          dismissOfflineStatus();
          setLayerMenuOpen(false);
        }}
        onCameraChanged={(state) => {
          if (!foregroundActiveRef.current) return;
          if (state.gestures.isGestureActive) dismissOfflineStatus();
          // Distinguish a pan from a pinch: a pinch keeps the driver near the
          // centre (we re-centre on every fix), a pan carries the centre away.
          // Comparing distance rather than listening for "any gesture" is what
          // lets zooming happen without cancelling Follow.
          if (NEW_MAP_FOLLOW && followRef.current && state.gestures.isGestureActive && Date.now() - selfCameraMoveAtRef.current > 400) {
            const coordinate = userCoordinateRef.current;
            const center = state.properties.center;
            if (coordinate && Array.isArray(center) && center.length >= 2) {
              // ~120px on screen, so the threshold scales with zoom instead of
              // being a fixed distance that is huge zoomed in and tiny zoomed out.
              const metersPerPixel = (156_543.03 * Math.cos((Number(center[1]) * Math.PI) / 180))
                / Math.pow(2, Number(state.properties.zoom));
              const drift = haversine(coordinate[1], coordinate[0], Number(center[1]), Number(center[0]));
              if (Number.isFinite(drift) && drift > metersPerPixel * 120) onFollowChangeRef.current?.(false);
            }
          }
          setFarmZoom((previous) => Math.abs(previous - state.properties.zoom) < 0.25 ? previous : state.properties.zoom);
          const zoom = Number(state.properties.zoom);
          const latitude = Number(state.properties.center[1]);
          setCameraState((previous) => (
            Math.abs(previous.zoom - zoom) < 0.02 && Math.abs(previous.latitude - latitude) < 0.01
              ? previous
              : { zoom, latitude }
          ));
          // Remember the live camera so returning to the Map tab restores it.
          const center = state.properties.center;
          const routeId = cameraRouteIdRef.current;
          if (routeId && Array.isArray(center) && center.length >= 2 && Number.isFinite(zoom)) {
            savedMapCamera = { routeId, center: [Number(center[0]), Number(center[1])], zoom };
          }
        }}
      >
        {cameraJump ? (
          <Camera
            ref={cameraRef}
            key={`sequence-${cameraJump.route.id}-${cameraJump.sequence.seq}`}
            centerCoordinate={[cameraJump.sequence.lng as number, cameraJump.sequence.lat as number]}
            zoomLevel={15}
            animationMode="none"
          />
        ) : (
          <Camera
            ref={cameraRef}
            animationMode="none"
            defaultSettings={initialCameraRef.current}
          />
        )}
        <UserLocation
          visible
          showsUserHeadingIndicator
          onPress={NEW_MAP_FOLLOW ? undefined : locateUser}
          onUpdate={(location) => {
            if (!foregroundActiveRef.current) return;
            const { latitude, longitude } = location.coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            userCoordinateRef.current = [longitude, latitude];
            if (NEW_MAP_FOLLOW && followRef.current) centerOnUser();
          }}
        />
        <ShapeSource id="road-crew-inactive" shape={routeData.inactiveLines}>
          <LineLayer
            id="rc-route-lines-inactive"
            style={{ lineColor: colors.textSubtle, lineWidth: 3, lineOpacity: 0.5, lineCap: "round", lineJoin: "round" }}
          />
        </ShapeSource>
        <ShapeSource id="road-crew-active" shape={routeData.activeLines}>
          <LineLayer
            id="rc-route-lines-active"
            style={{ lineColor: colors.brandRed, lineWidth: 4, lineOpacity: 0.9, lineCap: "round", lineJoin: "round" }}
          />
        </ShapeSource>
        <ShapeSource id="rc-sequences-inactive" shape={routeData.inactivePoints} onPress={selectSequence} hitbox={{ width: 28, height: 28 }}>
          <CircleLayer
            id="rc-sequence-points-inactive"
            style={{ circleColor: colors.textSubtle, circleRadius: 3, circleOpacity: 0.7, circleStrokeColor: colors.bgElevated, circleStrokeWidth: 1 }}
          />
        </ShapeSource>
        <ShapeSource id="rc-sequences-active" shape={routeData.activePoints} onPress={selectSequence} hitbox={{ width: 32, height: 32 }}>
          <CircleLayer
            id="rc-sequence-points-active"
            style={{
              circleColor: ["case", ["==", ["get", "seq"], nextSeqNum ?? -1], "#42d392", colors.brandRed] as never,
              circleRadius: ["case", ["==", ["get", "seq"], nextSeqNum ?? -1], 8, 4] as never,
              circleStrokeColor: ["case", ["==", ["get", "seq"], nextSeqNum ?? -1], "#ffffff", colors.bgElevated] as never,
              circleStrokeWidth: ["case", ["==", ["get", "seq"], nextSeqNum ?? -1], 2, 1] as never,
            }}
          />
          <SymbolLayer
            id="rc-sequence-labels-active"
            style={{
              textField: ["concat", ["to-string", ["get", "seq"]], " | ", ["coalesce", ["get", "town"], ""]] as never,
              textSize: ["case", ["==", ["get", "seq"], nextSeqNum ?? -1], 11, 10] as never,
              textColor: "#18181b",
              textHaloColor: "#ffffff",
              textHaloWidth: 1.4,
              textOffset: [0, 0.95],
              textAnchor: "top",
              textAllowOverlap: false,
            }}
          />
        </ShapeSource>
        {showCumberlandFarms ? (
          <>
            <ShapeSource
              id="rc-cumberland-farms"
              shape={farmData}
              onPress={selectFarmLayer}
              hitbox={{ width: 28, height: 28 }}
            >
              <CircleLayer
                id="rc-cumberland-farm-clusters"
                style={{
                  circleColor: FARM_BLUE,
                  circleRadius: ["step", ["get", "storeCount"], 8, 10, 10, 50, 12] as never,
                  circleOpacity: 0.95,
                  circleStrokeColor: colors.bgElevated,
                  circleStrokeWidth: 2,
                }}
              />
              <SymbolLayer
                id="rc-cumberland-farm-counts"
                style={{
                  textField: ["get", "label"] as never,
                  textSize: 10,
                  textColor: "#fff",
                  textFont: ["Open Sans Bold"],
                  textAllowOverlap: true,
                  textIgnorePlacement: true,
                }}
              />
            </ShapeSource>
            {standaloneFarms.map((farm) => (
              <MarkerView
                key={farm.id}
                coordinate={[farm.lng, farm.lat]}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap={false}
              >
                <Pressable
                  style={({ pressed }) => [styles.farmGasMarker, pressed && styles.farmGasMarkerPressed]}
                  onPress={() => selectFarm(farm)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open Cumberland Farms at ${farm.address}`}
                >
                  <View style={styles.farmGasIcon}>
                    {GAS_ICON_OUTLINE_OFFSETS.map(([x, y]) => (
                      <FontAwesome6
                        key={`${x}-${y}`}
                        name="gas-pump"
                        size={18}
                        color="#fff"
                        style={[styles.farmGasIconOutline, { transform: [{ translateX: x }, { translateY: y }] }]}
                      />
                    ))}
                    <FontAwesome6 name="gas-pump" size={18} color={FARM_BLUE} />
                  </View>
                </Pressable>
              </MarkerView>
            ))}
          </>
        ) : null}
        <ShapeSource
          ref={fleetSourceRef}
          id="rc-fleet"
          shape={fleetData}
          cluster
          clusterRadius={46}
          clusterMaxZoomLevel={15}
          onPress={(event) => void selectFleetLayer(event)}
          hitbox={{ width: 32, height: 32 }}
        >
          <CircleLayer
            id="rc-fleet-clusters"
            filter={["has", "point_count"]}
            style={{
              circleColor: FLEET_CLUSTER_COLOR,
              circleRadius: ["step", ["get", "point_count"], 10, 5, 12, 12, 14] as never,
              circleStrokeColor: colors.bgElevated,
              circleStrokeWidth: 2,
            }}
          />
          <SymbolLayer
            id="rc-fleet-cluster-counts"
            filter={["has", "point_count"]}
            style={{
              textField: ["get", "point_count_abbreviated"] as never,
              textSize: 10,
              textColor: FLEET_CLUSTER_TEXT_COLOR,
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
          <Images images={{ [VAN_MARKER_IMAGE_ID]: { image: VAN_MARKER_IMAGE, sdf: true } }} />
          <SymbolLayer
            id="rc-fleet-point-outlines"
            filter={["!", ["has", "point_count"]]}
            style={{
              iconImage: VAN_MARKER_IMAGE_ID,
              iconSize: VAN_MARKER_OUTLINE_ICON_SIZE,
              iconAnchor: "center",
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconColor: VAN_MARKER_OUTLINE_COLOR,
            }}
          />
          <SymbolLayer
            id="rc-fleet-points"
            filter={["!", ["has", "point_count"]]}
            style={{
              iconImage: VAN_MARKER_IMAGE_ID,
              iconSize: VAN_MARKER_ICON_SIZE,
              // Centred on the van's own GPS coordinate, which is what the
              // GeoJSON feature carries. Mapbox reprojects that coordinate on
              // every pan and zoom, so the icon tracks the fix rather than
              // holding a screen position — stated explicitly so it cannot
              // drift to a pin-style anchor later.
              iconAnchor: "center",
              // A van hidden behind a neighbour is a van the driver cannot
              // account for, so these never drop out for collision.
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconColor: ["match", ["get", "bucket"], "fresh", FLEET_BUCKET_COLOR.fresh, "stale", FLEET_BUCKET_COLOR.stale, FLEET_BUCKET_COLOR.old] as never,
            }}
          />
          <SymbolLayer
            id="rc-fleet-labels"
            filter={["!", ["has", "point_count"]]}
            style={{
              textField: ["get", "vanId"] as never,
              textSize: VAN_MARKER_LABEL_SIZE,
              textFont: VAN_MARKER_LABEL_FONT,
              textColor: colors.text,
              textHaloColor: colors.bg,
              textHaloWidth: VAN_MARKER_LABEL_HALO_WIDTH,
              // Crisp edge rather than a smeared one — the blur is what made
              // the small label read as muddy against the basemap.
              textHaloBlur: 0,
              // Clears the van icon, which stands taller than the 6px circle
              // this replaced.
              textOffset: [0, VAN_MARKER_LABEL_OFFSET_EM],
              textAnchor: "top",
              // The van ID is the point of the marker; never drop it for
              // collision with basemap labels.
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
        </ShapeSource>
        {selectedSequence ? (
          <MarkerView
            coordinate={selectedSequence.coordinate}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
            isSelected
          >
            <SequenceCallout
              selected={selectedSequence}
              navProvider={navProvider}
              onClose={() => setSelectedSequence(null)}
            />
          </MarkerView>
        ) : null}
        {selectedFarm ? (
          <MarkerView
            coordinate={selectedFarm.coordinate}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
            isSelected
          >
            <StoreCallout
              selected={selectedFarm}
              navProvider={navProvider}
              onClose={() => setSelectedFarm(null)}
            />
          </MarkerView>
        ) : null}
        {selectedFarmCluster ? (
          <MarkerView
            coordinate={selectedFarmCluster.coordinate}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
            isSelected
          >
            <StoreClusterCallout
              selected={selectedFarmCluster}
              navProvider={navProvider}
              onClose={() => setSelectedFarmCluster(null)}
            />
          </MarkerView>
        ) : null}
        {selectedVan ? (
          <MarkerView
            coordinate={selectedVan.coordinate}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
            isSelected
          >
            <VanCallout selected={selectedVan} onClose={() => setSelectedVan(null)} />
          </MarkerView>
        ) : null}
      </MapView>
      <OfflineMapStatus message={offlineStatus} />
      <View pointerEvents="box-none" style={styles.mapControls}>
        <Pressable
          style={({ pressed }) => [styles.mapControlFullscreen, { top: isFullscreen ? Math.max(32, safeInsets.top + 12) : 12 }, pressed && styles.mapControlPressed]}
          onPress={() => {
            setLayerMenuOpen(false);
            setIsFullscreen((expanded) => !expanded);
          }}
          accessibilityRole="button"
          accessibilityLabel={isFullscreen ? "Return map to normal size" : "Expand map to full screen"}
        >
          <FontAwesome6 name={isFullscreen ? "compress" : "expand"} size={15} color="#263238" />
        </Pressable>
        {!NEW_MAP_FOLLOW ? (
          <Pressable
            style={({ pressed }) => [styles.mapControlLocate, { bottom: locateButtonBottom }, pressed && styles.mapControlPressed]}
            onPress={locateUser}
            accessibilityRole="button"
            accessibilityLabel="Center map on my location"
          >
            <FontAwesome6 name="location-crosshairs" size={15} color="#263238" />
          </Pressable>
        ) : null}
        {layerMenuOpen ? (
          <View style={[styles.mapLayerMenu, { bottom: layerMenuBottom }]}>
            <Text style={styles.mapLayerMenuTitle}>Map layers</Text>
            <ScrollView style={styles.mapLayerMenuScroll} contentContainerStyle={styles.mapLayerMenuContent}>
              {layerItems.map((item) => {
                const visible = item.kind === "cumbys"
                  ? showCumberlandFarms
                  : layerVisibility[item.id] !== false;
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [styles.mapLayerRow, pressed && styles.mapLayerRowPressed]}
                    onPress={() => toggleLayer(item)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: visible }}
                    accessibilityLabel={`${item.label} map layer`}
                  >
                    <View style={[styles.mapLayerCheckbox, visible && styles.mapLayerCheckboxChecked]}>
                      {visible ? <FontAwesome6 name="check" size={9} color="#fff" /> : null}
                    </View>
                    {item.kind === "cumbys" ? (
                      <FontAwesome6 name="gas-pump" size={12} color={FARM_BLUE} style={styles.mapLayerKindIcon} />
                    ) : (
                      <View style={styles.mapLayerRouteSwatch} />
                    )}
                    <Text numberOfLines={1} style={styles.mapLayerLabel}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.mapControlLayers, { bottom: controlBottomBase }, pressed && styles.mapControlPressed]}
          onPress={() => setLayerMenuOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: layerMenuOpen }}
          accessibilityLabel="Map layers"
        >
          <FontAwesome6 name="layer-group" size={15} color="#263238" />
        </Pressable>
        <View pointerEvents="none" style={[styles.scaleControl, { bottom: controlBottomBase }]}>
          <Text style={styles.scaleLabel}>{scaleIndicator.label}</Text>
          <View style={[styles.scaleRule, { width: scaleIndicator.width }]}>
            <View style={styles.scaleTick} />
            <View style={styles.scaleTick} />
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      {isFullscreen ? (
        <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={() => setIsFullscreen(false)}>
          <View style={styles.fullscreenWrap}>{mapContent}</View>
        </Modal>
      ) : mapContent}
    </View>
  );
}

/** Native ArcGIS fallback. ArcGIS is hosted in a WebView when selected. */
function ArcGisRouteMap({ routes, activeId }: RouteMapProps) {
  const { WebView } = require("react-native-webview") as typeof import("react-native-webview");
  const source = useMemo(() => ({ html: arcGisHtml(routes, activeId) }), [routes, activeId]);
  return (
    <View style={styles.wrap}>
      <WebView
        originWhitelist={["*"]}
        source={source}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

function routeExtent(routes: Route[] | undefined, activeId?: string) {
  const route = routes?.find((item) => item.id === activeId) ?? routes?.[0];
  if (!route) return null;
  const bounds = coordinateBounds(routeMapCoordinates(route));
  if (!bounds) return null;
  return {
    xmin: bounds.sw[0],
    ymin: bounds.sw[1],
    xmax: bounds.ne[0],
    ymax: bounds.ne[1],
  };
}

function arcGisHtml(routes: Route[] | undefined, activeId?: string) {
  const itemId = mapProviderById("arcgis").itemId;
  const extent = routeExtent(routes, activeId);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <script type="module" src="https://js.arcgis.com/5.1/"></script>
    <style>
      html, body, arcgis-map { width: 100%; height: 100%; margin: 0; background: ${colors.bg}; }
      body { overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #status {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        color: ${colors.textMuted};
        text-align: center;
        background: ${colors.bgElevated};
      }
    </style>
  </head>
  <body class="calcite-mode-dark">
    <arcgis-map id="map" item-id="${itemId ?? ""}" aria-label="ArcGIS map showing the route atlas">
      <arcgis-locate position="top-left"></arcgis-locate>
      <arcgis-track position="top-right"></arcgis-track>
    </arcgis-map>
    <div id="status">Loading ArcGIS map...</div>
    <script type="module">
      const extent = ${JSON.stringify(extent)};
      customElements.whenDefined("arcgis-map")
        .then(async () => {
          const map = document.getElementById("map");
          const view = await map.viewOnReady();
          document.getElementById("status")?.remove();
          if (extent) {
            await view.goTo({
              target: { type: "extent", ...extent, spatialReference: { wkid: 4326 } },
              padding: { left: 24, right: 24, top: 24, bottom: 24 },
            });
          }
        })
        .catch(() => {
          const status = document.getElementById("status");
          if (status) status.textContent = navigator.onLine ? "Map couldn't load. Try again later." : "Map unavailable offline. Reconnect to load the map.";
        });
    </script>
  </body>
</html>`;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bgElevated },
  mapCanvas: { flex: 1 },
  fullscreenWrap: { flex: 1, backgroundColor: colors.bgElevated },
  map: { flex: 1 },
  webview: { flex: 1, backgroundColor: colors.bgElevated },
  statusWrap: { position: "absolute", top: 12, left: 12, right: 12, alignItems: "center" },
  statusPill: { maxWidth: "94%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(20,20,22,0.88)", borderWidth: 1, borderColor: colors.borderStrong },
  statusText: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  mapControls: { ...StyleSheet.absoluteFill },
  mapControlFullscreen: { position: "absolute", left: 12, width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: "rgba(255,255,255,0.95)", borderWidth: 1, borderColor: "rgba(0,0,0,0.18)", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  mapControlLayers: { position: "absolute", left: 12, width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: "rgba(255,255,255,0.95)", borderWidth: 1, borderColor: "rgba(0,0,0,0.18)", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  mapControlLocate: { position: "absolute", left: 12, width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: "rgba(255,255,255,0.95)", borderWidth: 1, borderColor: "rgba(0,0,0,0.18)", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  scaleControl: { position: "absolute", right: 12, alignItems: "center", minWidth: 44, paddingHorizontal: 6, paddingTop: 4, paddingBottom: 5, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.92)", borderWidth: 1, borderColor: "rgba(0,0,0,0.18)", shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  scaleLabel: { marginBottom: 2, color: "#263238", fontSize: 9, fontWeight: "700", lineHeight: 11 },
  scaleRule: { height: 6, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 2, borderTopColor: "#263238" },
  scaleTick: { width: 1, height: 5, backgroundColor: "#263238" },
  mapLayerMenu: { position: "absolute", left: 12, width: 220, maxHeight: 340, padding: 6, borderRadius: 8, backgroundColor: "rgba(20,20,22,0.96)", borderWidth: 1, borderColor: colors.borderStrong, shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 5 },
  mapLayerMenuTitle: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 5, color: colors.textMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  mapLayerMenuScroll: { flexGrow: 0 },
  mapLayerMenuContent: { gap: 2 },
  mapLayerRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 5 },
  mapLayerRowPressed: { backgroundColor: colors.bgControl },
  mapLayerCheckbox: { width: 14, height: 14, alignItems: "center", justifyContent: "center", borderRadius: 3, borderWidth: 1, borderColor: colors.textMuted },
  mapLayerCheckboxChecked: { backgroundColor: FARM_BLUE, borderColor: FARM_BLUE },
  mapLayerKindIcon: { width: 14, textAlign: "center" },
  mapLayerRouteSwatch: { width: 14, height: 3, borderRadius: 2, backgroundColor: colors.brandRed },
  mapLayerLabel: { flex: 1, color: colors.text, fontSize: 12 },
  mapControlPressed: { opacity: 0.68 },
  farmGasMarker: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  farmGasIcon: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  farmGasIconOutline: { position: "absolute" },
  farmGasMarkerPressed: { opacity: 0.62 },
  calloutWrap: { alignItems: "center" },
  callout: { width: 260, borderRadius: 10, padding: 12, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.borderStrong },
  calloutClose: { position: "absolute", zIndex: 1, top: 2, right: 4, width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  calloutClosePressed: { opacity: 0.6 },
  calloutCloseText: { color: colors.textMuted, fontSize: 22, lineHeight: 24 },
  calloutTip: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 10, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: colors.bgElevated },
  calloutHead: { paddingRight: 20, color: colors.brandRed, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  calloutHeadFleet: { color: colors.green },
  calloutTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: 2 },
  calloutRoute: { color: colors.textSubtle, fontSize: 11, marginTop: 2, marginBottom: 2 },
  calloutRow: { flexDirection: "row", gap: 8, marginTop: 5 },
  calloutKey: { width: 52, color: colors.textSubtle, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  calloutValue: { flex: 1, color: colors.text, fontSize: 12 },
  calloutStoreLink: { alignSelf: "flex-start", marginTop: 7 },
  calloutStoreLinkText: { color: colors.amber, fontSize: 11, fontWeight: "700" },
  calloutFlags: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  calloutFlag: { color: colors.text, backgroundColor: colors.brandRedSoft, borderWidth: 1, borderColor: colors.brandRedDark, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, fontWeight: "600" },
  calloutFarmInfo: { marginTop: 9, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.borderStrong },
  calloutFarmLabel: { color: colors.amber, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  calloutFarmAddress: { color: colors.text, fontSize: 12, fontWeight: "600", marginTop: 3 },
  calloutClusterRow: { position: "relative", marginTop: 8, paddingTop: 7, paddingRight: 38, borderTopWidth: 1, borderTopColor: colors.borderStrong },
  calloutClusterNavButton: { position: "absolute", right: 0, top: 7 },
  calloutNavRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  calloutNavButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.brandRed },
  calloutFarmButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.amber },
  calloutNavButtonPressed: { opacity: 0.72 },
});

export default memo(
  function RouteMap(props: RouteMapProps) {
    return props.mapType === "arcgis" ? <ArcGisRouteMap {...props} /> : <NativeMapboxRouteMap {...props} />;
  },
  (prev, next) => prev.routes === next.routes && prev.activeId === next.activeId && prev.nextSeqNum === next.nextSeqNum && prev.initialSequenceNumber === next.initialSequenceNumber && prev.cumberlandFarmsVisible === next.cumberlandFarmsVisible && prev.mapType === next.mapType && prev.navProvider === next.navProvider && prev.vans === next.vans && prev.selfVanId === next.selfVanId && prev.follow === next.follow && prev.onFollowChange === next.onFollowChange,
);
