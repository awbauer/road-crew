import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as RNImage } from "react-native";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { APP_CONFIG, mapProviderById, NEW_MAP_FOLLOW } from "@road-crew/config";
import { cumberlandFarmNavigationHref, displayCumberlandFarmStoreNumber, navigationHref } from "@road-crew/core";
import { CUMBERLAND_FARMS } from "@road-crew/data";
import { colors } from "@road-crew/ui";
import type { CumberlandFarm, Route } from "@road-crew/contracts";
import { useSharedGeolocation } from "@/field/Geolocation";
import { addBreadcrumb, captureError } from "@/monitoring";
import { useNow } from "@/ui/useNow";
import {
  describeFleetMarker,
  FLEET_BUCKET_COLOR,
  FLEET_CLUSTER_COLOR,
  FLEET_CLUSTER_TEXT_COLOR,
  formatFleetLastSeen,
  selectFleet,
} from "@/field/fleet.js";
import type { NavProvider } from "./Settings.tsx";
import type { RouteMapProps } from "./RouteMap.types.ts";
import {
  buildRouteMapModel,
  CUMBERLAND_FARMS_LAYER_ID,
  coordinateBounds,
  DEFAULT_CUMBERLAND_FARMS_VISIBLE,
  mapLayerControlItems,
  mapSequenceFlags,
  reconcileMapLayerVisibility,
  routeLayerVisibility,
  routeMapCoordinates,
  sequenceFromMapProperties,
  sequenceNumberRange,
  type MapLayerControlItem,
} from "./mapModel.ts";

/**
 * Web map — Mapbox GL JS, matching the legacy PWA (app/js/main.js Mapbox path).
 * Draws EVERY route's path line + sequence markers (the whole route network), with
 * the active route emphasized in red and the others muted. The next-target
 * sequence (from GPS) is drawn larger + green. Tapping a sequence marker opens a
 * detail popup (mirrors the legacy buildSeqPopup). Native is RouteMap.native.tsx.
 */
interface ArcGisView {
  goTo?: (
    target: {
      target: {
        type: "extent";
        xmin: number;
        ymin: number;
        xmax: number;
        ymax: number;
        spatialReference: { wkid: number };
      };
      padding: { left: number; right: number; top: number; bottom: number };
    },
  ) => Promise<unknown>;
}

type ArcGisMapElement = HTMLElement & {
  itemId?: string;
  viewOnReady?: () => Promise<ArcGisView>;
};

let arcGisScriptPromise: Promise<void> | null = null;

function ensureArcGisScript(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve();
  if (customElements.get("arcgis-map")) return Promise.resolve();
  if (arcGisScriptPromise) return arcGisScriptPromise;

  arcGisScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-rc-arcgis="true"]');
    const script = existing ?? document.createElement("script");
    const onLoad = () => resolve();
    const onError = () => {
      arcGisScriptPromise = null;
      reject(new Error("ArcGIS components failed to load."));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.type = "module";
      script.src = "https://js.arcgis.com/5.1/";
      script.dataset.rcArcgis = "true";
      document.head.appendChild(script);
    }
  });
  return arcGisScriptPromise;
}

interface MapboxRouteLayerData {
  id: string;
  routeId: string;
  routeName: string;
  features: GeoJSON.Feature[];
}

interface MapboxRouteData {
  activeRouteId: string | null;
  routes: MapboxRouteLayerData[];
  allCoords: [number, number][];
}

const EMPTY_MAPBOX_DATA: MapboxRouteData = {
  activeRouteId: null,
  routes: [],
  allCoords: [],
};

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

function buildMapboxRouteData(routes: Route[] | undefined, activeId?: string): MapboxRouteData {
  const model = buildRouteMapModel(routes, activeId);
  if (!model.routes.length) return EMPTY_MAPBOX_DATA;

  const routeLayers = model.routes.map((route): MapboxRouteLayerData => {
    const features: GeoJSON.Feature[] = [];
    if (route.coordinates.length >= 2) {
      features.push({
        type: "Feature",
        properties: { routeId: route.routeId, routeName: route.routeName },
        geometry: { type: "LineString", coordinates: route.coordinates },
      });
    }
    for (const sequence of route.sequences) {
      features.push({
        type: "Feature",
        properties: sequence.properties,
        geometry: { type: "Point", coordinates: sequence.coordinate },
      });
    }
    return {
      id: route.id,
      routeId: route.routeId,
      routeName: route.routeName,
      features,
    };
  });

  return {
    activeRouteId: model.activeRouteId,
    routes: routeLayers,
    allCoords: model.allCoordinates,
  };
}

function fitArcGisView(view: ArcGisView | null, routes: Route[] | undefined, activeId?: string) {
  const extent = routeExtent(routes, activeId);
  if (!view?.goTo || !extent) return;
  view.goTo({
    target: {
      type: "extent",
      ...extent,
      spatialReference: { wkid: 4326 },
    },
    padding: { left: 24, right: 24, top: 24, bottom: 24 },
  }).catch((error) => {
    addBreadcrumb("arcgis view goto failed", {
      activeId: activeId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function ArcGisRouteMap({ routes, activeId }: RouteMapProps) {
  const hostRef = useRef<ArcGisMapElement | null>(null);
  const viewRef = useRef<ArcGisView | null>(null);
  const [message, setMessage] = useState("Loading ArcGIS map...");

  useEffect(() => {
    const itemId = mapProviderById("arcgis").itemId;
    const host = hostRef.current;
    if (!host || !itemId) return;
    let cancelled = false;

    document.body.classList.add("calcite-mode-dark");
    host.setAttribute("item-id", itemId);
    host.itemId = itemId;

    if (!("customElements" in window)) {
      setMessage("ArcGIS map is unavailable in this browser.");
      return;
    }

    ensureArcGisScript()
      .then(() => customElements.whenDefined("arcgis-map"))
      .then(() => {
        if (!host.viewOnReady) throw new Error("ArcGIS map component did not expose viewOnReady");
        return host.viewOnReady();
      })
      .then((view) => {
        if (cancelled) return;
        viewRef.current = view;
        setMessage("");
        fitArcGisView(view, routes, activeId);
      })
      .catch((error) => {
        if (cancelled) return;
        if (typeof navigator !== "undefined" && navigator.onLine) {
          captureError(error, {
            tags: { source: "arcgis_init" },
            extra: { activeId: activeId ?? null },
          });
        } else {
          addBreadcrumb("arcgis map unavailable offline", { activeId: activeId ?? null });
        }
        setMessage(
          typeof navigator !== "undefined" && navigator.onLine
            ? "Map couldn't load. Try again later."
            : "Map unavailable offline. Reconnect to load the map.",
        );
      });

    return () => {
      cancelled = true;
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    fitArcGisView(viewRef.current, routes, activeId);
  }, [routes, activeId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: colors.bgElevated }}>
      {createElement(
        "arcgis-map" as never,
        {
          ref: hostRef,
          style: { display: "block", width: "100%", height: "100%" },
          "aria-label": "ArcGIS map showing the route atlas",
        },
        createElement("arcgis-locate" as never, { position: "top-left", key: "locate" }),
        createElement("arcgis-track" as never, { position: "top-right", key: "track" }),
      )}
      {message ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            color: colors.textMuted,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

// Sequence-marker popup — mirrors the legacy app/js/main.js buildSeqPopup. The
// point features carry the sequence fields as GeoJSON properties (primitives
// only), which Mapbox stringifies, so booleans arrive as "true"/"false".
const POPUP_STYLE_ID = "rc-mb-popup-styles";
// The driver's own position when the new map-follow interaction is enabled.
const USER_DOT_CSS = `
.rc-user-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #1d6fe0;
  border: 3px solid #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
}
`;
const POPUP_CSS = `
.mapboxgl-popup-content { box-sizing: border-box; width: 320px; max-width: calc(100vw - 24px); max-height: calc(100vh - 32px); overflow-y: auto; background: ${colors.bgElevated}; color: ${colors.text}; border: 1px solid ${colors.borderStrong}; border-radius: 10px; padding: 12px 14px; font-size: 12px; line-height: 1.35; }
.mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib { display: none !important; }
.mapboxgl-popup-tip { border-top-color: ${colors.bgElevated} !important; border-bottom-color: ${colors.bgElevated} !important; }
.mapboxgl-popup-close-button { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; color: ${colors.textMuted}; font-size: 18px; padding: 0; }
.mb-popup-head { padding-right: 24px; color: ${colors.brandRed}; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.mb-popup-head-fleet { color: ${colors.green}; }
.mb-popup-title { font-size: 14px; font-weight: 700; margin-top: 2px; }
.mb-popup-route { color: ${colors.textSubtle}; font-size: 11px; margin-top: 1px; }
.mb-popup-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); column-gap: 8px; margin-top: 4px; }
.mb-popup-row .k { color: ${colors.textSubtle}; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
.mb-popup-row > :last-child { min-width: 0; overflow-wrap: anywhere; }
.mb-popup-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.mb-popup-flag { background: ${colors.brandRedSoft}; border: 1px solid ${colors.brandRedDark}; color: ${colors.text}; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: 600; }
.mb-popup-nav-row { display: flex; justify-content: flex-end; margin-top: 8px; }
.mb-popup-store-row { display: flex; justify-content: flex-start; margin-top: 8px; }
.mb-popup-nav-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: ${colors.brandRed}; color: #fff; border-radius: 6px; text-decoration: none; }
.mb-popup-nav-btn .fa6-nav-icon { font-family: "FontAwesome6Free-Solid"; font-size: 16px; line-height: 1; }
.mb-popup-farm-link { color: ${colors.amber}; font-size: 11px; font-weight: 700; text-decoration: none; }
@media (max-width: 480px) {
  .mapboxgl-popup-content { width: calc(100vw - 20px); max-width: 280px; max-height: calc(100dvh - 72px); padding: 10px 12px; }
  .mb-popup-row { grid-template-columns: 44px minmax(0, 1fr); column-gap: 6px; }
  .mb-popup-nav-btn { width: 40px; height: 40px; }
}
`;

function ensurePopupStyles() {
  if (typeof document === "undefined" || document.getElementById(POPUP_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = POPUP_STYLE_ID;
  el.textContent = `${POPUP_CSS}\n${USER_DOT_CSS}`;
  document.head.appendChild(el);
}

function keepPopupInMapViewport(map: any, popup: any) {
  requestAnimationFrame(() => {
    const mapElement = map.getContainer?.() as HTMLElement | undefined;
    const popupElement = popup.getElement?.() as HTMLElement | undefined;
    const contentElement = popupElement?.querySelector<HTMLElement>(".mapboxgl-popup-content");
    if (!mapElement || !popupElement || !contentElement) return;

    const mapRect = mapElement.getBoundingClientRect();
    const margin = 12;
    contentElement.style.maxHeight = `${Math.max(180, mapRect.height - margin * 2)}px`;
    const popupRect = popupElement.getBoundingClientRect();

    let shiftX = 0;
    let shiftY = 0;
    if (popupRect.left < mapRect.left + margin) {
      shiftX = mapRect.left + margin - popupRect.left;
    } else if (popupRect.right > mapRect.right - margin) {
      shiftX = mapRect.right - margin - popupRect.right;
    }
    if (popupRect.top < mapRect.top + margin) {
      shiftY = mapRect.top + margin - popupRect.top;
    } else if (popupRect.bottom > mapRect.bottom - margin) {
      shiftY = mapRect.bottom - margin - popupRect.bottom;
    }

    if (shiftX || shiftY) {
      map.panBy([-shiftX, -shiftY], { duration: 180 });
    }
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Font Awesome 6 `diamond-turn-right` (U+F5EB), rendered as text because this
// popup is built as an HTML string outside the React tree.
const NAV_ICON = '<span class="fa6-nav-icon" aria-hidden="true">&#xf5eb;</span>';

function buildSeqPopup(p: Record<string, unknown>, navProvider: NavProvider): string {
  const sequence = sequenceFromMapProperties(p);
  const flags = mapSequenceFlags(sequence);
  const numRange = sequenceNumberRange(sequence);
  const navHref = navigationHref(sequence, navProvider);
  const navBtn = navHref !== "#"
    ? `<a class="mb-popup-nav-btn" href="${navHref}" target="_blank" rel="noopener" aria-label="Navigate">${NAV_ICON}</a>`
    : "";

  const lines: string[] = [];
  lines.push(`<div class="mb-popup-head">SEQ #${escapeHtml(p.seq)} · ${escapeHtml(p.town)}</div>`);
  lines.push(`<div class="mb-popup-title">${escapeHtml(p.street)}</div>`);
  if (p.routeName) lines.push(`<div class="mb-popup-route">${escapeHtml(p.routeName)}</div>`);
  if (p.dir) lines.push(`<div class="mb-popup-row"><span class="k">Dir</span><span>${escapeHtml(p.dir)}</span></div>`);
  if (numRange) lines.push(`<div class="mb-popup-row"><span class="k">Nums</span><span>${escapeHtml(numRange)}</span></div>`);
  if (p.cum_miles != null && p.cum_miles !== "") lines.push(`<div class="mb-popup-row"><span class="k">Cum mi</span><span>${escapeHtml(p.cum_miles)}</span></div>`);
  if (p.distanceToNextLabel) lines.push(`<div class="mb-popup-row"><span class="k">Dist next</span><span>${escapeHtml(p.distanceToNextLabel)}</span></div>`);
  if (p.riderTimesLabel) lines.push(`<div class="mb-popup-row"><span class="k">Riders</span><span>${escapeHtml(p.riderTimesLabel)}</span></div>`);
  if (p.intersection) lines.push(`<div class="mb-popup-row"><span class="k">Int</span><span>${escapeHtml(p.intersection)}</span></div>`);
  if (flags.length) lines.push(`<div class="mb-popup-flags">${flags.map((f) => `<span class="mb-popup-flag">${escapeHtml(f)}</span>`).join("")}</div>`);
  if (navBtn) lines.push(`<div class="mb-popup-nav-row">${navBtn}</div>`);

  return `<div class="mb-popup">${lines.join("")}</div>`;
}

function buildFarmPopup(farm: CumberlandFarm, navProvider: NavProvider): string {
  const href = cumberlandFarmNavigationHref(farm, navProvider);
  const phone = farm.phone ? `<div class="mb-popup-row"><span class="k">Phone</span><span>${escapeHtml(farm.phone)}</span></div>` : "";
  const hours = farm.hours ? `<div class="mb-popup-row"><span class="k">Hours</span><span>${escapeHtml(farm.hours)}</span></div>` : "";
  const store = `<div class="mb-popup-row"><span class="k">Store</span><span>#${escapeHtml(displayCumberlandFarmStoreNumber(farm.storeNumber))}</span></div>`;
  const storeLink = farm.source
    ? `<div class="mb-popup-store-row"><a class="mb-popup-farm-link" href="${escapeHtml(farm.source)}" target="_blank" rel="noopener">Store details</a></div>`
    : "";
  const navBtn = href !== "#"
    ? `<a class="mb-popup-nav-btn" href="${href}" target="_blank" rel="noopener" aria-label="Navigate to Cumberland Farms">${NAV_ICON}</a>`
    : "";
  return `<div class="mb-popup"><div class="mb-popup-head">${escapeHtml(farm.name)}</div><div class="mb-popup-title">${escapeHtml(farm.address)}</div><div class="mb-popup-route">${escapeHtml(farm.city)}, ${escapeHtml(farm.state)} ${escapeHtml(farm.zip)}</div>${store}${phone}${hours}${storeLink}${navBtn ? `<div class="mb-popup-nav-row">${navBtn}</div>` : ""}</div>`;
}

function buildFleetPopup(properties: Record<string, unknown>): string {
  const routeName = properties.routeName || "Unavailable";
  return [
    `<div class="mb-popup"><div class="mb-popup-head mb-popup-head-fleet">${escapeHtml(properties.vanId)}</div>`,
    `<div class="mb-popup-row"><span class="k">Route</span><span>${escapeHtml(routeName)}</span></div>`,
    `<div class="mb-popup-row"><span class="k">Last seen</span><span>${escapeHtml(properties.lastSeenLabel || "Unknown")}</span></div>`,
    "</div>",
  ].join("");
}

function farmFromFeatureProperties(properties: Record<string, unknown>): CumberlandFarm {
  return {
    id: String(properties.id ?? ""),
    name: String(properties.name ?? "Cumberland Farms"),
    storeNumber: String(properties.storeNumber ?? ""),
    address: String(properties.address ?? ""),
    city: String(properties.city ?? ""),
    state: String(properties.state ?? ""),
    zip: String(properties.zip ?? ""),
    phone: String(properties.phone ?? ""),
    hours: String(properties.hours ?? ""),
    lat: Number(properties.lat),
    lng: Number(properties.lng),
    source: String(properties.source ?? ""),
  };
}

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

const CUMBERLAND_FARM_DATA = featureCollection(CUMBERLAND_FARMS.map((farm) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [farm.lng, farm.lat] },
  properties: {
    id: farm.id,
    storeNumber: farm.storeNumber,
    name: farm.name,
    address: farm.address,
    city: farm.city,
    state: farm.state,
    zip: farm.zip,
    phone: farm.phone ?? "",
    hours: farm.hours ?? "",
    lat: farm.lat,
    lng: farm.lng,
    source: farm.source,
  },
})));

const CUMBERLAND_FARM_LAYER_IDS = [
  "cumbys-farm-clusters",
  "cumbys-farm-cluster-counts",
  "cumbys-farm-gas-icons",
] as const;

function setCumberlandFarmLayerVisibility(map: mapboxgl.Map | null, visible: boolean): void {
  if (!map) return;
  for (const layerId of CUMBERLAND_FARM_LAYER_IDS) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function setRouteLayerVisibility(
  map: mapboxgl.Map | null,
  route: MapboxRouteLayerData,
  activeRouteId: string | null,
  visible: boolean,
): void {
  if (!map) return;
  const visibility = routeLayerVisibility(route.routeId, activeRouteId, visible);
  for (const suffix of ["path", "points", "labels"] as const) {
    const layerId = `${route.id}-${suffix}`;
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility[suffix] ? "visible" : "none");
    }
  }
}

// Font Awesome Free v7 gas-pump icon, rendered into an SDF so Mapbox can
// recolor it while keeping the supplied silhouette.
const CUMBERLAND_GAS_PUMP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path fill="#fff" d="M96 128C96 92.7 124.7 64 160 64L320 64C355.3 64 384 92.7 384 128L384 320L392 320C440.6 320 480 359.4 480 408L480 440C480 453.3 490.7 464 504 464C517.3 464 528 453.3 528 440L528 286C500.4 278.9 480 253.8 480 224L480 164.5L454.2 136.2C445.3 126.4 446 111.2 455.8 102.3C465.6 93.4 480.8 94.1 489.7 103.9L561.4 182.7C570.8 193 576 206.4 576 220.4L576 440C576 479.8 543.8 512 504 512C464.2 512 432 479.8 432 440L432 408C432 385.9 414.1 368 392 368L384 368L384 529.4C393.3 532.7 400 541.6 400 552C400 565.3 389.3 576 376 576L104 576C90.7 576 80 565.3 80 552C80 541.5 86.7 532.7 96 529.4L96 128zM160 144L160 240C160 248.8 167.2 256 176 256L304 256C312.8 256 320 248.8 320 240L320 144C320 135.2 312.8 128 304 128L176 128C167.2 128 160 135.2 160 144z"/></svg>`;
const gasPumpImagePromises = new WeakMap<object, Promise<boolean>>();

function ensureGasPumpImage(map: mapboxgl.Map): Promise<boolean> {
  if (map.hasImage("cumbys-gas-pump")) return Promise.resolve(true);
  const existing = gasPumpImagePromises.get(map);
  if (existing) return existing;

  const promise = new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        if (!map.hasImage("cumbys-gas-pump")) {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const context = canvas.getContext("2d");
          if (!context) {
            resolve(false);
            return;
          }
          context.drawImage(image, 0, 0, 64, 64);
          map.addImage("cumbys-gas-pump", context.getImageData(0, 0, 64, 64), { sdf: true });
        }
        resolve(map.hasImage("cumbys-gas-pump"));
      } catch {
        resolve(false);
      }
    };
    image.onerror = () => resolve(false);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CUMBERLAND_GAS_PUMP_SVG)}`;
  });
  gasPumpImagePromises.set(map, promise);
  return promise;
}

function sequencePaint(isActive: boolean, nextSeqNum: number | null | undefined): NonNullable<mapboxgl.CirclePaint> {
  const isNext = isActive && nextSeqNum != null ? ["==", ["get", "seq"], nextSeqNum] : false;
  return {
    "circle-radius": isActive ? ["case", isNext, 8, 4] : 3,
    "circle-color": isActive ? ["case", isNext, colors.green, colors.brandRed] : colors.textSubtle,
    "circle-opacity": isActive ? 1 : 0.7,
    "circle-stroke-width": isActive ? ["case", isNext, 2, 1] : 1,
    "circle-stroke-color": isActive ? ["case", isNext, "#ffffff", colors.bgElevated] : colors.bgElevated,
  } as NonNullable<mapboxgl.CirclePaint>;
}

function sequenceLabelTextField() {
  return [
    "concat",
    ["to-string", ["get", "seq"]],
    " | ",
    ["coalesce", ["get", "town"], ""],
  ];
}

function sequenceLabelLayout(isActive: boolean, nextSeqNum: number | null | undefined): NonNullable<mapboxgl.SymbolLayout> {
  const isNext = isActive && nextSeqNum != null ? ["==", ["get", "seq"], nextSeqNum] : false;
  return {
    "text-field": sequenceLabelTextField(),
    "text-size": ["case", isNext, 11, 10],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-anchor": "top",
    "text-offset": [0, 0.95],
    "text-justify": "center",
    "text-max-width": 12,
    "text-allow-overlap": false,
    "text-ignore-placement": false,
  } as unknown as NonNullable<mapboxgl.SymbolLayout>;
}

function sequenceLabelPaint(isActive: boolean, nextSeqNum: number | null | undefined): NonNullable<mapboxgl.SymbolPaint> {
  const isNext = isActive && nextSeqNum != null ? ["==", ["get", "seq"], nextSeqNum] : false;
  // All labels stay black with a white halo; only the next-target marker is green.
  return {
    "text-color": "#18181b",
    "text-halo-color": "#ffffff",
    "text-halo-width": 1.4,
    "text-halo-blur": 0.2,
  } as NonNullable<mapboxgl.SymbolPaint>;
}

function applyRouteLayerStyles(
  map: mapboxgl.Map | null,
  routeLayers: MapboxRouteLayerData[],
  activeId: string | undefined,
  nextSeqNum: number | null | undefined,
): void {
  if (!map) return;
  const activeRouteId = activeId ?? routeLayers[0]?.routeId;
  for (const route of routeLayers) {
    const isActive = route.routeId === activeRouteId;
    const pointLayerId = `${route.id}-points`;
    const labelLayerId = `${route.id}-labels`;
    const lineLayerId = `${route.id}-path`;
    if (map.getLayer(lineLayerId)) {
      map.setPaintProperty(lineLayerId, "line-color", isActive ? colors.brandRed : colors.textSubtle);
      map.setPaintProperty(lineLayerId, "line-width", isActive ? 4 : 3);
      map.setPaintProperty(lineLayerId, "line-opacity", isActive ? 0.85 : 0.5);
    }
    if (map.getLayer(pointLayerId)) {
      const paint = sequencePaint(isActive, nextSeqNum);
      for (const property of ["circle-radius", "circle-color", "circle-opacity", "circle-stroke-width", "circle-stroke-color"] as const) {
        map.setPaintProperty(pointLayerId, property, paint[property]);
      }
    }
    if (map.getLayer(labelLayerId)) {
      const layout = sequenceLabelLayout(isActive, nextSeqNum);
      const paint = sequenceLabelPaint(isActive, nextSeqNum);
      map.setLayoutProperty(labelLayerId, "visibility", isActive ? "visible" : "none");
      map.setLayoutProperty(labelLayerId, "text-size", layout["text-size"]);
      map.setPaintProperty(labelLayerId, "text-color", paint["text-color"]);
      map.setPaintProperty(labelLayerId, "text-halo-color", paint["text-halo-color"]);
      map.setPaintProperty(labelLayerId, "text-halo-width", paint["text-halo-width"]);
    }
  }
}

const FARM_BLUE = colors.blue;
const EXPAND_ICON = '<svg viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="M32 32C14.3 32 0 46.3 0 64v96c0 17.7 14.3 32 32 32s32-14.3 32-32V96h64c17.7 0 32-14.3 32-32S145.7 32 128 32H32Zm288 0c-17.7 0-32 14.3-32 32s14.3 32 32 32h64v64c0 17.7 14.3 32 32 32s32-14.3 32-32V64c0-17.7-14.3-32-32-32h-96ZM32 320c-17.7 0-32 14.3-32 32v96c0 17.7 14.3 32 32 32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32H64v-64c0-17.7-14.3-32-32-32Zm384 0c-17.7 0-32 14.3-32 32v64h-64c-17.7 0-32 14.3-32 32s14.3 32 32 32h96c17.7 0 32-14.3 32-32v-96c0-17.7-14.3-32-32-32Z"/></svg>';
const COMPRESS_ICON = '<svg viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="M160 32c0-17.7-14.3-32-32-32S96 14.3 96 32v64H32C14.3 96 0 110.3 0 128s14.3 32 32 32h96c17.7 0 32-14.3 32-32V32Zm160 0v96c0 17.7 14.3 32 32 32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32h-64V32c0-17.7-14.3-32-32-32s-32 14.3-32 32ZM128 320H32c-17.7 0-32 14.3-32 32s14.3 32 32 32h64v96c0 17.7 14.3 32 32 32s32-14.3 32-32v-96c0-17.7-14.3-32-32-32Zm224 0c-17.7 0-32 14.3-32 32v96h-64c-17.7 0-32 14.3-32 32s14.3 32 32 32h96c17.7 0 32-14.3 32-32v-96h64c17.7 0 32-14.3 32-32s-14.3-32-32-32h-96Z"/></svg>';

const LAYER_ICON = '<span class="fa6-layer-icon" aria-hidden="true">&#xf5fd;</span>';

class MapLayerControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private menu: HTMLDivElement | null = null;
  private layers: MapLayerControlItem[] = [];
  private visibility: Record<string, boolean> = {};

  constructor(private readonly onToggle: (id: string) => void) {}

  onAdd(map: mapboxgl.Map): HTMLElement {
    void map;
    this.container = document.createElement("div");
    this.container.className = "mapboxgl-ctrl mapboxgl-ctrl-group rc-map-layer-control";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "mapboxgl-ctrl-icon rc-layer-control-icon";
    this.button.setAttribute("aria-label", "Map layers");
    this.button.setAttribute("aria-expanded", "false");
    this.button.title = "Map layers";
    this.button.innerHTML = LAYER_ICON;
    this.button.addEventListener("click", this.toggleMenu);
    this.container.appendChild(this.button);
    this.menu = document.createElement("div");
    this.menu.className = "rc-map-layer-menu";
    this.menu.setAttribute("aria-label", "Map layers");
    this.container.appendChild(this.menu);
    return this.container;
  }

  onRemove(): void {
    this.button?.removeEventListener("click", this.toggleMenu);
    this.container?.remove();
    this.button = null;
    this.container = null;
    this.menu = null;
  }

  setLayers(layers: MapLayerControlItem[], visibility: Record<string, boolean>): void {
    this.layers = layers;
    this.visibility = visibility;
    this.render();
  }

  private toggleMenu = (): void => {
    if (!this.menu || !this.button) return;
    const open = this.menu.classList.toggle("rc-map-layer-menu-open");
    this.button.setAttribute("aria-expanded", String(open));
  };

  private render(): void {
    if (!this.menu) return;
    this.menu.replaceChildren();
    for (const layer of this.layers) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "rc-map-layer-row";
      const visible = this.visibility[layer.id] !== false;
      row.setAttribute("aria-pressed", String(visible));
      row.addEventListener("click", () => this.onToggle(layer.id));
      const check = document.createElement("span");
      check.className = `rc-layer-check${visible ? " rc-layer-check-on" : ""}`;
      check.setAttribute("aria-hidden", "true");
      check.textContent = visible ? "✓" : "";
      const icon = document.createElement("span");
      icon.className = layer.kind === "cumbys" ? "rc-layer-kind rc-layer-kind-cumbys" : "rc-layer-kind rc-layer-kind-route";
      icon.setAttribute("aria-hidden", "true");
      if (layer.kind === "cumbys") icon.innerHTML = "&#xf52f;";
      const label = document.createElement("span");
      label.className = "rc-map-layer-label";
      label.textContent = layer.label;
      row.append(check, icon, label);
      this.menu.appendChild(row);
    }
  }
}

// The van silhouette Command's Crew Vans map uses (Font Awesome van-shuttle),
// rasterized to a white-on-transparent PNG so both map adapters can load the
// one asset. Registered as an SDF, which is what lets `icon-color` tint it per
// freshness bucket the way the circles it replaces were tinted.
const VAN_MARKER_IMAGE = require("../../public/icons/van-marker.png") as number;
const VAN_MARKER_IMAGE_ID = "rc-van-marker";
const VAN_MARKER_IMAGE_PX = 96;
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
// Label gap below the marker, in ems of the label size.
const VAN_MARKER_LABEL_OFFSET_EM = 1.45;
const vanImagePromises = new WeakMap<object, Promise<boolean>>();

function ensureVanMarkerImage(map: mapboxgl.Map): Promise<boolean> {
  if (map.hasImage(VAN_MARKER_IMAGE_ID)) return Promise.resolve(true);
  const existing = vanImagePromises.get(map);
  if (existing) return existing;

  const promise = new Promise<boolean>((resolve) => {
    const uri = RNImage.resolveAssetSource(VAN_MARKER_IMAGE)?.uri;
    if (typeof document === "undefined" || !uri) {
      resolve(false);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        if (!map.hasImage(VAN_MARKER_IMAGE_ID)) {
          const canvas = document.createElement("canvas");
          canvas.width = VAN_MARKER_IMAGE_PX;
          canvas.height = VAN_MARKER_IMAGE_PX;
          const context = canvas.getContext("2d");
          if (!context) {
            resolve(false);
            return;
          }
          context.drawImage(image, 0, 0, VAN_MARKER_IMAGE_PX, VAN_MARKER_IMAGE_PX);
          map.addImage(
            VAN_MARKER_IMAGE_ID,
            context.getImageData(0, 0, VAN_MARKER_IMAGE_PX, VAN_MARKER_IMAGE_PX),
            { sdf: true },
          );
        }
        resolve(map.hasImage(VAN_MARKER_IMAGE_ID));
      } catch {
        resolve(false);
      }
    };
    image.onerror = () => resolve(false);
    image.src = uri;
  });
  vanImagePromises.set(map, promise);
  return promise;
}

const FLEET_MARKER_STYLE_ID = "rc-fleet-marker-styles";
const FLEET_MARKER_CSS = `
.rc-map-control { position: absolute; z-index: 2; display: flex; align-items: center; gap: 6px; border: 1px solid rgba(0,0,0,0.18); border-radius: 4px; background: rgba(255,255,255,0.95); color: #263238; box-shadow: 0 1px 4px rgba(0,0,0,0.28); cursor: pointer; font: inherit; }
.rc-map-control:hover { background: #fff; }
.rc-map-control:focus-visible { outline: 2px solid ${colors.amber}; outline-offset: 2px; }
.rc-map-control-fullscreen { top: 12px; left: 12px; width: 34px; height: 34px; justify-content: center; padding: 0; }
.rc-map-control-fullscreen svg { width: 15px; height: 15px; }
.rc-layer-control-icon { display: flex; align-items: center; justify-content: center; }
.rc-layer-control-icon .fa6-layer-icon { font-family: "FontAwesome6Free-Solid"; font-size: 15px; line-height: 1; }
.rc-map-layer-control { position: relative; }
.rc-map-layer-menu { display: none; position: absolute; left: 0; bottom: calc(100% + 6px); width: 220px; max-height: min(60vh, 420px); box-sizing: border-box; overflow: auto; padding: 6px; border: 1px solid ${colors.borderStrong}; border-radius: 8px; background: rgba(20,20,22,0.96); box-shadow: 0 2px 8px rgba(0,0,0,0.45); }
.rc-map-layer-menu-open { display: flex; flex-direction: column; gap: 2px; }
.rc-map-layer-control .rc-map-layer-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; min-height: 32px; box-sizing: border-box; padding: 6px 8px; border: 0; border-radius: 5px; background: transparent; color: ${colors.text}; cursor: pointer; font: inherit; font-size: 12px; text-align: left; white-space: nowrap; }
.rc-map-layer-row:hover, .rc-map-layer-row:focus-visible { background: ${colors.bgControl}; }
.rc-map-layer-row:focus-visible { outline: 2px solid ${colors.amber}; outline-offset: -2px; }
.rc-layer-check { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 14px; width: 14px; height: 14px; box-sizing: border-box; border: 1px solid ${colors.textMuted}; border-radius: 3px; color: #fff; font-size: 11px; font-weight: 800; line-height: 1; }
.rc-layer-check-on { border-color: ${FARM_BLUE}; background: ${FARM_BLUE}; }
.rc-layer-kind { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 14px; width: 14px; height: 14px; text-align: center; }
.rc-layer-kind-route { width: 14px; height: 3px; border-radius: 2px; background: ${colors.brandRed}; }
.rc-layer-kind-cumbys { color: ${FARM_BLUE}; font-family: "FontAwesome6Free-Solid"; font-size: 13px; line-height: 1; }
.rc-map-layer-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
`;

function ensureFleetMarkerStyles() {
  if (typeof document === "undefined" || document.getElementById(FLEET_MARKER_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = FLEET_MARKER_STYLE_ID;
  el.textContent = FLEET_MARKER_CSS;
  document.head.appendChild(el);
}

function MapboxRouteMap({
  routes,
  activeId,
  nextSeqNum,
  initialSequenceNumber = null,
  onInitialSequenceOpened,
  cumberlandFarmsVisible = DEFAULT_CUMBERLAND_FARMS_VISIBLE,
  onCumberlandFarmsVisibleChange,
  navProvider = "apple",
  vans,
  selfVanId = null,
  follow = false,
  onFollowChange,
}: RouteMapProps) {
  const fleetNowMs = useNow(true, 30_000);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // mapbox-gl ships its own declarations while this workspace also carries
  // @types/mapbox-gl for the web-only build; keep the imperative bridge loose
  // so the two declaration copies cannot make native-unrelated builds fail.
  const mapRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const userCenterRef = useRef<[number, number] | null>(null);
  const followRef = useRef(NEW_MAP_FOLLOW && follow);
  followRef.current = NEW_MAP_FOLLOW && follow;
  const onFollowChangeRef = useRef(onFollowChange);
  onFollowChangeRef.current = onFollowChange;
  const fittedRef = useRef(false);

  /**
   * Re-centre on the driver without changing zoom, pitch or bearing.
   *
   * `easeTo({ center })` only, deliberately: Mapbox's own tracking mode uses
   * fitBounds, which recomputes zoom from the accuracy circle on every fix and
   * would fight the user pinching to zoom.
   */
  const centerOnUser = useCallback(() => {
    const map = mapRef.current;
    const center = userCenterRef.current;
    if (!map || !center) return;
    map.easeTo({ center, duration: 300 });
  }, []);

  // The app's shared watch is already running for the GPS panel and follow
  // status, so the map reuses it rather than opening a second geolocation
  // watch of its own.
  const { fix } = useSharedGeolocation();

  const jumpedSequenceRef = useRef<string | null>(null);
  const navProviderRef = useRef<NavProvider>(navProvider);
  const nextSeqNumRef = useRef<number | null>(nextSeqNum ?? null);
  const onInitialSequenceOpenedRef = useRef(onInitialSequenceOpened);
  const onCumberlandFarmsVisibleChangeRef = useRef(onCumberlandFarmsVisibleChange);
  const cumberlandFarmsVisibleRef = useRef(cumberlandFarmsVisible);
  const popupRef = useRef<any>(null);
  const sequencePopupRef = useRef<(feature: GeoJSON.Feature) => void>(() => {});
  const registeredRouteLayerIdsRef = useRef<Set<string>>(new Set());
  const routeLayersRef = useRef<MapboxRouteLayerData[]>([]);
  const layerControlRef = useRef<MapLayerControl | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    [CUMBERLAND_FARMS_LAYER_ID]: cumberlandFarmsVisible,
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const routeData = useMemo(() => buildMapboxRouteData(routes, activeId), [routes, activeId]);
  const fleetData = useMemo(() => featureCollection(selectFleet(vans, { selfVanId, now: fleetNowMs }).map((van) => {
    const details = describeFleetMarker(van, routes);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [van.lng, van.lat] },
      properties: {
        vanId: van.vanId,
        bucket: van.bucket,
        routeName: details?.routeName ?? "",
        lastSeenLabel: formatFleetLastSeen(van.ageMs),
      },
    } as GeoJSON.Feature;
  })), [fleetNowMs, routes, selfVanId, vans]);
  const layerItems = useMemo(() => mapLayerControlItems(routeData.routes), [routeData.routes]);
  const jumpSequence = useMemo(() => {
    if (!Number.isInteger(initialSequenceNumber) || initialSequenceNumber == null) return null;
    const route = routes?.find((item) => item.id === activeId) ?? routes?.[0];
    const sequence = route?.sequences.find((item) => item.seq === initialSequenceNumber);
    if (!route || !sequence || !Number.isFinite(sequence.lat) || !Number.isFinite(sequence.lng)) return null;
    return { route, sequence };
  }, [routes, activeId, initialSequenceNumber]);
  useEffect(() => {
    const marker = userMarkerRef.current;
    if (!marker) return;
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
      marker.getElement().style.visibility = "hidden";
      return;
    }
    userCenterRef.current = [fix.lng, fix.lat];
    marker.setLngLat([fix.lng, fix.lat]);
    marker.getElement().style.visibility = "visible";
    if (NEW_MAP_FOLLOW && followRef.current) centerOnUser();
  }, [fix, centerOnUser]);

  useEffect(() => {
    if (!NEW_MAP_FOLLOW || !follow) return undefined;
    centerOnUser();
    const map = mapRef.current;
    if (!map) return undefined;
    const onDragStart = () => onFollowChangeRef.current?.(false);
    map.on("dragstart", onDragStart);
    return () => map.off("dragstart", onDragStart);
  }, [follow, centerOnUser]);
  navProviderRef.current = navProvider;
  nextSeqNumRef.current = nextSeqNum ?? null;
  onInitialSequenceOpenedRef.current = onInitialSequenceOpened;
  onCumberlandFarmsVisibleChangeRef.current = onCumberlandFarmsVisibleChange;

  useEffect(() => {
    cumberlandFarmsVisibleRef.current = cumberlandFarmsVisible;
    setLayerVisibility((previous) => (
      previous[CUMBERLAND_FARMS_LAYER_ID] === cumberlandFarmsVisible
        ? previous
        : { ...previous, [CUMBERLAND_FARMS_LAYER_ID]: cumberlandFarmsVisible }
    ));
  }, [cumberlandFarmsVisible]);

  useEffect(() => {
    setLayerVisibility((previous) => reconcileMapLayerVisibility(
      previous,
      routeData.routes,
      routeData.activeRouteId,
      cumberlandFarmsVisibleRef.current,
    ));
  }, [routeData.activeRouteId, routeData.routes]);

  useEffect(() => {
    if (initialSequenceNumber == null) jumpedSequenceRef.current = null;
  }, [initialSequenceNumber]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement === shellRef.current) {
      void document.exitFullscreen?.();
      return;
    }
    if (isFullscreen && !document.fullscreenElement) {
      setIsFullscreen(false);
      return;
    }
    const requestFullscreen = shellRef.current?.requestFullscreen;
    if (!requestFullscreen) {
      setIsFullscreen(true);
      return;
    }
    void requestFullscreen.call(shellRef.current).catch(() => setIsFullscreen(true));
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePopupStyles();
    ensureFleetMarkerStyles();
    mapboxgl.accessToken = APP_CONFIG.mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: APP_CONFIG.mapboxStyle,
      center: [-70.6, 41.9],
      zoom: 6.4,
      // Matches legacy (app/js/main.js): Mapbox's ToS requires attribution
      // unless on an enterprise plan, so this stays on.
      attributionControl: false,
      projection: { name: "mercator" },
      fadeDuration: 0,
    }) as any;
    mapRef.current = map;
    const layerControl = new MapLayerControl((id) => {
      if (id === CUMBERLAND_FARMS_LAYER_ID) {
        const visible = !cumberlandFarmsVisibleRef.current;
        cumberlandFarmsVisibleRef.current = visible;
        setLayerVisibility((previous) => ({ ...previous, [id]: visible }));
        onCumberlandFarmsVisibleChangeRef.current?.(visible);
        return;
      }
      setLayerVisibility((previous) => ({ ...previous, [id]: previous[id] === false }));
    });
    layerControlRef.current = layerControl;
    map.addControl(layerControl, "bottom-left");
    if (NEW_MAP_FOLLOW) {
      // Follow uses the app's existing GPS watch, avoiding a second browser
      // watch and Mapbox's zoom-changing tracking behavior.
      const userMarkerEl = document.createElement("div");
      userMarkerEl.className = "rc-user-dot";
      userMarkerRef.current = new mapboxgl.Marker({ element: userMarkerEl })
        .setLngLat([0, 0])
        .addTo(map);
      userMarkerEl.style.visibility = "hidden";
    } else {
      // Keep the legacy one-shot locate control while the new map-follow
      // interaction is disabled.
      map.addControl(
        new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true }),
        "top-right",
      );
    }
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: true, showZoom: false, visualizePitch: false }),
      "top-right",
    );
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: "imperial" }), "bottom-right");

    // Tapping a sequence marker opens its detail popup (legacy parity). The
    // layer-scoped listeners are safe to register before the layers exist.
    const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "320px" });
    popupRef.current = popup;
    const showSequencePopup = (feature: GeoJSON.Feature) => {
      if (!feature || feature.geometry.type !== "Point") return;
      const properties = feature.properties ?? {};
      popup
        .setLngLat((feature.geometry.coordinates as [number, number]).slice() as [number, number])
        .setHTML(buildSeqPopup(properties, navProviderRef.current))
        .addTo(map);
      keepPopupInMapViewport(map, popup);
    };
    sequencePopupRef.current = showSequencePopup;
    const showFarmPopup = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      popup
        .setLngLat(e.lngLat)
        .setHTML(buildFarmPopup(farmFromFeatureProperties(feature.properties ?? {}), navProviderRef.current))
        .addTo(map);
      keepPopupInMapViewport(map, popup);
    };
    const expandFarmCluster = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource("cumberland-farms") as any;
      if (clusterId == null || !source?.getClusterExpansionZoom) return;
      source.getClusterExpansionZoom(Number(clusterId), (error: Error | null, zoom: number) => {
        if (error) return;
        map.easeTo({ center: e.lngLat, zoom });
      });
    };
    const showFleetPopup = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      popup
        .setLngLat(e.lngLat)
        .setHTML(buildFleetPopup(feature.properties ?? {}))
        .addTo(map);
      keepPopupInMapViewport(map, popup);
    };
    const expandFleetCluster = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource("rc-fleet") as any;
      if (clusterId == null || !source?.getClusterExpansionZoom) return;
      source.getClusterExpansionZoom(Number(clusterId), (error: Error | null, zoom: number) => {
        if (error) return;
        map.easeTo({ center: e.lngLat, zoom });
      });
    };
    const onEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", "cumbys-farm-gas-icons", showFarmPopup);
    map.on("click", "cumbys-farm-clusters", expandFarmCluster);
    map.on("click", "rc-fleet-points", showFleetPopup);
    map.on("click", "rc-fleet-clusters", expandFleetCluster);
    for (const layer of ["cumbys-farm-gas-icons", "cumbys-farm-clusters", "rc-fleet-points", "rc-fleet-clusters"]) {
      map.on("mouseenter", layer, onEnter);
      map.on("mouseleave", layer, onLeave);
    }

    // The map container often gets its final size a frame or two after mount
    // (RN Web flexbox settling, tab focus, or a fresh reload after App Reset).
    // If Mapbox initializes at 0×0 / stale dimensions it paints blank until
    // something forces a repaint, so keep it in sync with the real container
    // size via a ResizeObserver (plus a resize once the style loads).
    map.once("load", () => map.resize());
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => map.resize())
      : null;
    if (resizeObserver && containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver?.disconnect();
      popup.remove();
      popupRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      sequencePopupRef.current = () => {};
      registeredRouteLayerIdsRef.current.clear();
      map.remove();
      mapRef.current = null;
      layerControlRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const drawFleet = async () => {
      if (cancelled) return;
      const source = map.getSource("rc-fleet") as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(fleetData);
        return;
      }
      // Awaited before the layers go in so the point layer can be the icon
      // variant from the start; a failed decode falls back to the circle
      // rather than leaving the fleet unrendered.
      const vanImageAvailable = await ensureVanMarkerImage(map);
      if (cancelled || map.getSource("rc-fleet")) return;
      map.addSource("rc-fleet", {
        type: "geojson",
        data: fleetData,
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 46,
      });
      map.addLayer({
        id: "rc-fleet-clusters",
        type: "circle",
        source: "rc-fleet",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": FLEET_CLUSTER_COLOR,
          "circle-radius": ["step", ["get", "point_count"], 10, 5, 12, 12, 14],
          "circle-stroke-color": colors.bgElevated,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "rc-fleet-cluster-counts",
        type: "symbol",
        source: "rc-fleet",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 10,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": FLEET_CLUSTER_TEXT_COLOR },
      });
      if (vanImageAvailable) {
        map.addLayer({
          id: "rc-fleet-point-outlines",
          type: "symbol",
          source: "rc-fleet",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": VAN_MARKER_IMAGE_ID,
            "icon-size": VAN_MARKER_OUTLINE_ICON_SIZE,
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-color": VAN_MARKER_OUTLINE_COLOR },
        });
      }
      map.addLayer(vanImageAvailable
        ? {
            id: "rc-fleet-points",
            type: "symbol",
            source: "rc-fleet",
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": VAN_MARKER_IMAGE_ID,
              "icon-size": VAN_MARKER_ICON_SIZE,
              // Centred on the van's own GPS coordinate, which is what the
              // GeoJSON feature carries. Mapbox reprojects that coordinate on
              // every pan and zoom, so the icon tracks the fix rather than
              // holding a screen position — stated explicitly so it cannot
              // drift to a pin-style anchor later.
              "icon-anchor": "center",
              // A van hidden behind a neighbour is a van the driver cannot
              // account for, so these never drop out for collision.
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: {
              "icon-color": ["match", ["get", "bucket"], "fresh", FLEET_BUCKET_COLOR.fresh, "stale", FLEET_BUCKET_COLOR.stale, FLEET_BUCKET_COLOR.old],
            },
          }
        : {
            id: "rc-fleet-points",
            type: "circle",
            source: "rc-fleet",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": ["match", ["get", "bucket"], "fresh", FLEET_BUCKET_COLOR.fresh, "stale", FLEET_BUCKET_COLOR.stale, FLEET_BUCKET_COLOR.old],
              "circle-radius": 6,
              "circle-stroke-color": colors.bgElevated,
              "circle-stroke-width": 2,
            },
          });
      map.addLayer({
        id: "rc-fleet-labels",
        type: "symbol",
        source: "rc-fleet",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "vanId"],
          "text-size": VAN_MARKER_LABEL_SIZE,
          "text-font": VAN_MARKER_LABEL_FONT,
          // Clears the van icon, which stands taller than the 6px circle this
          // replaced. Kept in step with the native adapter.
          "text-offset": [0, VAN_MARKER_LABEL_OFFSET_EM],
          "text-anchor": "top",
          // The van ID is the point of the marker; never drop it for collision
          // with basemap labels.
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": colors.text,
          "text-halo-color": colors.bg,
          "text-halo-width": VAN_MARKER_LABEL_HALO_WIDTH,
          // Crisp edge rather than a smeared one — the blur is what made the
          // small label read as muddy against the basemap.
          "text-halo-blur": 0,
        },
      });
    };
    if (map.isStyleLoaded()) void drawFleet();
    else map.once("load", () => void drawFleet());
    return () => { cancelled = true; };
  }, [fleetData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeData.allCoords.length) return;
    let cancelled = false;

    const draw = async () => {
      const currentIds = new Set(routeData.routes.map((route) => route.id));
      for (const previousRoute of routeLayersRef.current) {
        if (currentIds.has(previousRoute.id)) continue;
        for (const suffix of ["labels", "points", "path"] as const) {
          const layerId = `${previousRoute.id}-${suffix}`;
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          registeredRouteLayerIdsRef.current.delete(layerId);
        }
        if (map.getSource(previousRoute.id)) map.removeSource(previousRoute.id);
      }

      // Mapbox renders later-added layers above earlier ones. Add route groups
      // in reverse data order so their visual stacking is reversed as well.
      for (const route of [...routeData.routes].reverse()) {
        const sourceData = featureCollection(route.features);
        if (map.getSource(route.id)) {
          (map.getSource(route.id) as mapboxgl.GeoJSONSource).setData(sourceData);
        } else {
          map.addSource(route.id, { type: "geojson", data: sourceData });
          const isActive = route.routeId === routeData.activeRouteId;
          map.addLayer({
            id: `${route.id}-path`,
            type: "line",
            source: route.id,
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": isActive ? colors.brandRed : colors.textSubtle,
              "line-width": isActive ? 4 : 3,
              "line-opacity": isActive ? 0.85 : 0.5,
            },
          });
          map.addLayer({
            id: `${route.id}-points`,
            type: "circle",
            source: route.id,
            filter: ["==", ["geometry-type"], "Point"],
            paint: sequencePaint(isActive, nextSeqNumRef.current),
          });
          map.addLayer({
            id: `${route.id}-labels`,
            type: "symbol",
            source: route.id,
            filter: ["==", ["geometry-type"], "Point"],
            layout: {
              ...sequenceLabelLayout(isActive, nextSeqNumRef.current),
              visibility: isActive ? "visible" : "none",
            },
            paint: sequenceLabelPaint(isActive, nextSeqNumRef.current),
          });
        }

        if (!registeredRouteLayerIdsRef.current.has(`${route.id}-points`)) {
          for (const suffix of ["points", "labels"] as const) {
            const layerId = `${route.id}-${suffix}`;
            map.on("click", layerId, (event: mapboxgl.MapLayerMouseEvent) => {
              const feature = event.features?.[0];
              if (feature) sequencePopupRef.current(feature);
            });
            map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
            registeredRouteLayerIdsRef.current.add(layerId);
          }
        }
        setRouteLayerVisibility(
          map,
          route,
          routeData.activeRouteId,
          layerVisibility[route.id] !== false,
        );
      }
      routeLayersRef.current = routeData.routes;
      applyRouteLayerStyles(map, routeData.routes, routeData.activeRouteId ?? undefined, nextSeqNumRef.current);

      const gasPumpImageAvailable = await ensureGasPumpImage(map);
      if (cancelled) return;
      if (!map.getSource("cumberland-farms")) {
        map.addSource("cumberland-farms", {
          type: "geojson",
          data: CUMBERLAND_FARM_DATA,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 42,
        });
        map.addLayer({
          id: "cumbys-farm-clusters",
          type: "circle",
          source: "cumberland-farms",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": FARM_BLUE,
            "circle-radius": ["step", ["get", "point_count"], 8, 10, 10, 50, 12],
            "circle-opacity": 0.95,
            "circle-stroke-color": colors.bgElevated,
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "cumbys-farm-cluster-counts",
          type: "symbol",
          source: "cumberland-farms",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 10,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: { "text-color": "#fff" },
        });
      }
      if (gasPumpImageAvailable && !map.getLayer("cumbys-farm-gas-icons")) {
        map.addLayer({
          id: "cumbys-farm-gas-icons",
          type: "symbol",
          source: "cumberland-farms",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": "cumbys-gas-pump",
            "icon-size": 0.39,
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
          },
          paint: {
            "icon-color": FARM_BLUE,
            "icon-halo-color": "#fff",
            "icon-halo-width": 2.5,
            "icon-halo-blur": 0,
          },
        });
      }
      setCumberlandFarmLayerVisibility(map, layerVisibility[CUMBERLAND_FARMS_LAYER_ID] !== false);
      for (const layerId of ["rc-fleet-clusters", "rc-fleet-cluster-counts", "rc-fleet-point-outlines", "rc-fleet-points", "rc-fleet-labels"]) {
        if (map.getLayer(layerId)) map.moveLayer(layerId);
      }

      // Fit to the whole network once (don't re-fit as the GPS next-target moves).
      if (!fittedRef.current) {
        const allCoords = routeData.allCoords;
        if (allCoords.length) {
          const bounds = allCoords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]),
          );
          map.fitBounds(bounds, { padding: 28, duration: 0 });
          fittedRef.current = true;
        }
      }

      if (jumpSequence) {
        const jumpKey = `${jumpSequence.route.id}:${jumpSequence.sequence.seq}`;
        if (jumpedSequenceRef.current !== jumpKey) {
          const targetFeature = routeData.routes
            .find((route) => route.routeId === jumpSequence.route.id)?.features
            .find((feature) => Number(feature.properties?.seq) === jumpSequence.sequence.seq);
          map.jumpTo({ center: [jumpSequence.sequence.lng as number, jumpSequence.sequence.lat as number], zoom: 15 });
          if (targetFeature) {
            sequencePopupRef.current(targetFeature);
            jumpedSequenceRef.current = jumpKey;
            onInitialSequenceOpenedRef.current?.();
          }
        }
      }
    };

    if (map.isStyleLoaded()) void draw();
    else map.once("load", draw);
    return () => { cancelled = true; };
  }, [routeData, jumpSequence, layerVisibility]);

  useEffect(() => {
    layerControlRef.current?.setLayers(layerItems, layerVisibility);
  }, [layerItems, layerVisibility]);

  useEffect(() => {
    applyRouteLayerStyles(
      mapRef.current,
      routeData.routes,
      routeData.activeRouteId ?? undefined,
      nextSeqNum,
    );
  }, [routeData.activeRouteId, routeData.routes, nextSeqNum]);

  useEffect(() => {
    setCumberlandFarmLayerVisibility(mapRef.current, layerVisibility[CUMBERLAND_FARMS_LAYER_ID] !== false);
    for (const route of routeData.routes) {
      setRouteLayerVisibility(
        mapRef.current,
        route,
        routeData.activeRouteId,
        layerVisibility[route.id] !== false,
      );
    }
    if (layerVisibility[CUMBERLAND_FARMS_LAYER_ID] === false) popupRef.current?.remove();
  }, [routeData.routes, layerVisibility]);

  return (
    <div
      ref={shellRef}
      style={isFullscreen
        ? { position: "fixed", inset: 0, zIndex: 1000, backgroundColor: colors.bg }
        : { position: "relative", width: "100%", height: "100%" }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <button
        className="rc-map-control rc-map-control-fullscreen"
        type="button"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Return map to normal size" : "Expand map to full screen"}
        title={isFullscreen ? "Return map to normal size" : "Expand map to full screen"}
        dangerouslySetInnerHTML={{ __html: isFullscreen ? COMPRESS_ICON : EXPAND_ICON }}
      />
    </div>
  );
}

export default function RouteMap(props: RouteMapProps) {
  if (props.mapType === "arcgis") return <ArcGisRouteMap {...props} />;
  return <MapboxRouteMap {...props} />;
}
