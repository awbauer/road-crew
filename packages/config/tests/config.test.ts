import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  APP_VERSION,
  APP_CONFIG,
  ENDPOINTS,
  APP_ENVIRONMENTS,
  resolveAppEnvironment,
  isLocalHostname,
  sentryConfigForHostname,
  mapProviderById,
  navProviderById,
  resolveApiBaseUrl,
  resolveRuntimeApiBaseUrl,
  NEW_MAP_FOLLOW,
} from "../src/index.ts";

test("new map follow remains opt-in", () => {
  assert.equal(NEW_MAP_FOLLOW, false);
});

test("version constant shape + format", () => {
  assert.match(APP_VERSION.build, /^\d{8}$/);
  assert.match(APP_VERSION.release, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(APP_VERSION).sort(), ["build", "release"]);
  assert.equal(APP_CONFIG.appVersion, APP_VERSION.release);
  assert.equal(APP_CONFIG.buildNumber, APP_VERSION.build);
});

test("Expo app config derives release/build metadata from shared config", () => {
  const staticConfig = JSON.parse(
    readFileSync(new URL("../../../apps/road-crew/app.json", import.meta.url), "utf8"),
  );
  const require = createRequire(import.meta.url);
  const resolveExpoConfig = require("../../../apps/road-crew/app.config.js");
  const resolvedConfig = resolveExpoConfig({ config: staticConfig.expo });

  assert.equal("version" in staticConfig.expo, false);
  assert.equal("buildNumber" in staticConfig.expo.ios, false);
  assert.equal("versionCode" in staticConfig.expo.android, false);
  assert.equal(resolvedConfig.version, APP_VERSION.release);
  assert.equal(resolvedConfig.ios.buildNumber, APP_VERSION.build);
  assert.equal(resolvedConfig.android.versionCode, Number(APP_VERSION.build));
  assert.equal(resolvedConfig.runtimeVersion, APP_VERSION.release);
  assert.match(resolvedConfig.updates.url, /^https:\/\/u\.expo\.dev\//);

  const history = readFileSync(
    new URL("../VERSION_HISTORY.md", import.meta.url),
    "utf8",
  );
  assert.match(history, new RegExp(`^### v${APP_VERSION.release.replaceAll(".", "\\.")} \\(build ${APP_VERSION.build}\\)$`, "m"));
});

test("endpoints and cadence stay aligned", () => {
  assert.equal(ENDPOINTS.messages, "/api/messages");
  assert.equal(ENDPOINTS.vans, "/api/vans");
  assert.equal(ENDPOINTS.heartbeat, "/api/heartbeat");
  assert.equal(ENDPOINTS.locations, "/api/locations");
  assert.equal(ENDPOINTS.notifications, "/api/notifications");
  assert.equal(ENDPOINTS.version, "/version");
  assert.equal(APP_CONFIG.pollIntervalMs, 10_000);
  assert.equal(APP_CONFIG.requestTimeoutMs, 4_000);
  assert.equal(APP_CONFIG.messageTimeoutMs, 15_000);
  assert.equal(APP_CONFIG.scheme, "roadcrew");
});

test("environment resolution", () => {
  assert.equal(resolveAppEnvironment("localhost"), APP_ENVIRONMENTS.local);
  assert.equal(resolveAppEnvironment("127.0.0.1"), APP_ENVIRONMENTS.local);
  assert.equal(resolveAppEnvironment("rc.awbauer.dev"), APP_ENVIRONMENTS.production);
  assert.equal(resolveAppEnvironment("road-crew-pr-12--preview.example"), APP_ENVIRONMENTS.featureBranch);
  assert.equal(isLocalHostname("box.local"), true);
});

test("sentry enabled only in production with a dsn", () => {
  assert.equal(sentryConfigForHostname("rc.awbauer.dev").enabled, true);
  assert.equal(sentryConfigForHostname("localhost").enabled, false);
  assert.equal(sentryConfigForHostname("road-crew-x--y.example").enabled, false);
});

test("provider lookups fall back to the first entry", () => {
  assert.equal(mapProviderById("arcgis").itemId, "abba84c1864d4acbbaad9cffa591186f");
  assert.equal(mapProviderById("nope").id, "mapbox");
  assert.equal(navProviderById("waze").id, "waze");
  assert.equal(navProviderById("nope").id, "apple");
});

test("resolveApiBaseUrl: env → extra → fallback, trailing slash trimmed", () => {
  assert.equal(resolveApiBaseUrl({ envUrl: "https://env.example/" }), "https://env.example");
  assert.equal(resolveApiBaseUrl({ extraUrl: "https://extra.example" }), "https://extra.example");
  assert.equal(resolveApiBaseUrl({}), APP_CONFIG.defaultApiBaseUrl);
  assert.equal(resolveApiBaseUrl({ fallback: "" }), "");
});

test("resolveRuntimeApiBaseUrl keeps web requests on the serving origin", () => {
  assert.equal(
    resolveRuntimeApiBaseUrl({
      platform: "web",
      origin: "https://beta.example/",
      extraUrl: "https://production.example",
    }),
    "https://beta.example",
  );
  assert.equal(
    resolveRuntimeApiBaseUrl({
      platform: "web",
      origin: "https://beta.example",
      envUrl: "http://localhost:8787/",
    }),
    "http://localhost:8787",
  );
  assert.equal(
    resolveRuntimeApiBaseUrl({ platform: "ios", extraUrl: "https://native.example/" }),
    "https://native.example",
  );
});
