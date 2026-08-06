/**
 * Unified runtime configuration for both the web and native clients.
 *
 * It is intentionally free of platform imports (no `expo-constants`,
 * no `window`) so it can be consumed by Metro, the Worker, and `node --test`.
 * Platform-specific inputs (the resolved API base URL, the current hostname)
 * are passed in by the app layer rather than read here.
 */

import { APP_VERSION } from "./version.ts";

export { APP_VERSION } from "./version.ts";
export type { VersionInfo } from "./version.ts";

// Keep the newer map-follow interaction dark until it has been validated in
// the field. The legacy in-map locate control remains active while false.
export const NEW_MAP_FOLLOW = false;

export const APP_ENVIRONMENTS = {
  local: "local",
  featureBranch: "feature-branch",
  production: "production",
} as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[keyof typeof APP_ENVIRONMENTS];

/**
 * Worker API endpoint paths (same routes for web same-origin and native
 * absolute). The whole `/api/*` surface is protected as a unit at the edge; the
 * client attaches Cloudflare Access service-token headers to reach it. `version`
 * is intentionally a top-level, unauthenticated call so update checks keep
 * working even when `/api/*` is locked down.
 */
export const ENDPOINTS = {
  heartbeat: "/api/heartbeat",
  notifications: "/api/notifications",
  messages: "/api/messages",
  vans: "/api/vans",
  locations: "/api/locations",
  version: "/version",
} as const;

export interface MapProvider {
  id: string;
  label: string;
  itemId?: string;
}

export interface NavProvider {
  id: string;
  label: string;
}

export const APP_CONFIG = {
  appVersion: APP_VERSION.release,
  buildNumber: APP_VERSION.build,
  sentryRelease: `${APP_VERSION.release}+${APP_VERSION.build}`,
  // Supplied per deployment, never committed. Use a public (`pk.`) token: it is
  // inlined into the client bundle by Metro, so it is readable by anyone who
  // has the app. Maps and native reverse-geocoding stay inert until it is set.
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "",
  // Public Mapbox-owned Standard style — authorized with any valid public
  // token. The sequence popups stay dark regardless of the basemap.
  mapboxStyle: "mapbox://styles/mapbox/standard",
  // Default absolute base for native clients (web uses same-origin, base "").
  defaultApiBaseUrl: "https://rc.awbauer.dev",
  // Shared polling cadence for notifications, message sync, and admin refresh.
  pollIntervalMs: 10_000,
  // Fetch abort timeout for fast Worker API calls (polling, reads).
  requestTimeoutMs: 4_000,
  // Longer timeout for message sends, which go through a Durable Object and can
  // be slow on cold start.
  messageTimeoutMs: 15_000,
  // How many consecutive SSE errors before falling back to polling (native).
  sseErrorThreshold: 3,
  // Cap on how many messages we keep per conversation in the UI / DB read path.
  maxLocalMessages: 500,
  // Deep-link scheme (must match app.json `scheme`).
  scheme: "roadcrew",
  mapProviders: [
    { id: "mapbox", label: "Mapbox" },
    { id: "arcgis", label: "ArcGIS", itemId: "abba84c1864d4acbbaad9cffa591186f" },
  ] as MapProvider[],
  navProviders: [
    { id: "apple", label: "Apple Maps" },
    { id: "google", label: "Google Maps" },
    { id: "waze", label: "Waze" },
  ] as NavProvider[],
  sentry: {
    productionDsn:
      "https://46e31f78a40142fcb48ceff0b6ab1608@o4511486510366720.ingest.us.sentry.io/4511486830116864",
    featureBranchDsn: "",
    featureBranchDsnPlaceholder: "__ADD_FEATURE_BRANCH_SENTRY_DSN__",
    customProductionHostnames: ["rc.awbauer.dev"],
    // Performance tracing sample rate. Errors are always captured; only
    // spans/transactions are sampled.
    tracesSampleRate: 1.0,
  },
} as const;

function normalizeHostname(hostname: string | null | undefined): string {
  return String(hostname || "").trim().toLowerCase();
}

export function isLocalHostname(hostname: string | null | undefined): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === ""
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "[::1]"
    || normalized === "0.0.0.0"
    || normalized.endsWith(".local")
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function isProductionHostname(hostname: string | null | undefined): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "road-crew"
    || normalized.startsWith("road-crew.")
    || (APP_CONFIG.sentry.customProductionHostnames as readonly string[]).includes(normalized);
}

function isFeatureBranchHostname(hostname: string | null | undefined): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized.startsWith("road-crew-") || normalized.includes("--");
}

export function resolveAppEnvironment(hostname: string | null | undefined): AppEnvironment {
  if (isLocalHostname(hostname)) return APP_ENVIRONMENTS.local;
  if (isProductionHostname(hostname)) return APP_ENVIRONMENTS.production;
  return isFeatureBranchHostname(hostname)
    ? APP_ENVIRONMENTS.featureBranch
    : APP_ENVIRONMENTS.local;
}

export interface SentryConfig {
  environment: AppEnvironment;
  dsn: string;
  enabled: boolean;
}

export function sentryConfigForHostname(hostname: string | null | undefined): SentryConfig {
  const environment = resolveAppEnvironment(hostname);
  const dsn = environment === APP_ENVIRONMENTS.production
    ? APP_CONFIG.sentry.productionDsn
    : environment === APP_ENVIRONMENTS.featureBranch
      ? APP_CONFIG.sentry.featureBranchDsn
      : "";
  return {
    environment,
    dsn,
    enabled: environment === APP_ENVIRONMENTS.production && Boolean(dsn),
  };
}

export function mapProviderById(id: string): MapProvider {
  return APP_CONFIG.mapProviders.find((provider) => provider.id === id)
    || APP_CONFIG.mapProviders[0];
}

export function navProviderById(id: string): NavProvider {
  return APP_CONFIG.navProviders.find((provider) => provider.id === id)
    || APP_CONFIG.navProviders[0];
}

/**
 * Resolves the API base URL. Web passes nothing (same-origin, base ""). Native
 * passes the env var and `expo.extra.apiBaseUrl` it reads from expo-constants;
 * this keeps the platform dependency in the app layer.
 */
export function resolveApiBaseUrl(input: {
  envUrl?: string | null;
  extraUrl?: string | null;
  fallback?: string;
} = {}): string {
  const { envUrl, extraUrl, fallback = APP_CONFIG.defaultApiBaseUrl } = input;
  const value = envUrl || (typeof extraUrl === "string" ? extraUrl : "") || fallback;
  return value.replace(/\/+$/, "");
}

/**
 * Resolves the platform API base without baking the production host into web
 * exports. An explicit environment override still wins for local development.
 */
export function resolveRuntimeApiBaseUrl(input: {
  platform: string;
  origin?: string | null;
  envUrl?: string | null;
  extraUrl?: string | null;
}): string {
  const { platform, origin, envUrl, extraUrl } = input;
  const web = platform === "web";
  const fallback = web
    ? (typeof origin === "string" ? origin : "")
    : APP_CONFIG.defaultApiBaseUrl;
  return resolveApiBaseUrl({
    envUrl,
    extraUrl: web ? null : extraUrl,
    fallback,
  });
}
