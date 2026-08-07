import Constants from "expo-constants";
import { Platform } from "react-native";
import { APP_CONFIG, ENDPOINTS, resolveRuntimeApiBaseUrl } from "@road-crew/config";

/**
 * Runtime configuration for the app.
 *
 * The constants (endpoints, cadence, timeouts) now come from the shared
 * `@road-crew/config` package so web and native cannot drift. This module is the
 * thin native adapter: it resolves the absolute API base URL from Expo's
 * config (the web build uses same-origin relative paths, so it does not need
 * this) and re-exposes the same `CONFIG` shape existing screens already import.
 *
 * The base URL defaults to production and can be overridden per-build via
 * `expo.extra.apiBaseUrl` in app.json or the `EXPO_PUBLIC_API_BASE_URL` env var
 * (handy for pointing at a PR preview deployment or `wrangler dev`).
 * Van install is a platform capability: every native binary supports it and
 * the hosted web app never does. It is deliberately not environment-driven,
 * so builds and OTA manifests cannot drift.
 */

function apiBaseUrl(): string {
  const fromExtra = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.apiBaseUrl;
  const origin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null;
  return resolveRuntimeApiBaseUrl({
    platform: Platform.OS,
    origin,
    envUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    extraUrl: typeof fromExtra === "string" ? fromExtra : undefined,
  });
}

function vanInstallEnabled(): boolean {
  return Platform.OS !== "web";
}

export const CONFIG = Object.freeze({
  apiBaseUrl: apiBaseUrl(),
  vanInstallEnabled: vanInstallEnabled(),

  messagesPath: ENDPOINTS.messages,
  heartbeatPath: ENDPOINTS.heartbeat,
  versionPath: ENDPOINTS.version,
  vansPath: ENDPOINTS.vans,
  locationsPath: ENDPOINTS.locations,

  pollIntervalMs: APP_CONFIG.pollIntervalMs,
  requestTimeoutMs: APP_CONFIG.requestTimeoutMs,
  messageTimeoutMs: APP_CONFIG.messageTimeoutMs,

  sseErrorThreshold: APP_CONFIG.sseErrorThreshold,
  maxLocalMessages: APP_CONFIG.maxLocalMessages,

  scheme: APP_CONFIG.scheme,
});

export type AppConfig = typeof CONFIG;
