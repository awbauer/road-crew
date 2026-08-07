import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSequenceOfflinePlan,
  isOfflineMapTransientError,
  isRoadCrewOfflinePack,
  offlineMapRetryDelay,
  OFFLINE_TILE_LIMIT,
  SEQUENCE_TILE_RADIUS_METERS,
} from "../src/field/offlineMapPlan.ts";

const route = {
  id: "day1_route1",
  sequences: [
    { seq: 1, lat: 42.23869, lng: -71.80487 },
    { seq: 2, lat: 42.23862, lng: -71.80421 },
    { seq: 3, lat: null, lng: null },
  ],
};

test("sequence offline plans use only valid sequence coordinates", () => {
  const plan = buildSequenceOfflinePlan(route);
  assert.ok(plan);
  assert.equal(plan.routeId, route.id);
  assert.equal(plan.regions.length, 2);
  assert.deepEqual(plan.regions.map((region) => region.sequenceNumber), [1, 2]);
  assert.equal(new Set(plan.regions.map((region) => region.name)).size, 2);
});

test("sequence regions stay centered on their marker with the configured radius", () => {
  const plan = buildSequenceOfflinePlan(route);
  assert.ok(plan);
  const { ne, sw } = plan.regions[0].bounds;
  assert.ok(Math.abs((ne[1] + sw[1]) / 2 - route.sequences[0].lat) < 1e-10);
  assert.ok(Math.abs((ne[0] + sw[0]) / 2 - route.sequences[0].lng) < 1e-10);
  assert.ok(Math.abs((ne[1] - sw[1]) * 111_320 / 2 - SEQUENCE_TILE_RADIUS_METERS) < 0.01);
});

test("route coordinate changes produce a new plan and pack names", () => {
  const original = buildSequenceOfflinePlan(route);
  const changed = buildSequenceOfflinePlan({
    ...route,
    sequences: [{ ...route.sequences[0], lat: route.sequences[0].lat + 0.01 }, route.sequences[1]],
  });
  assert.ok(original);
  assert.ok(changed);
  assert.notEqual(changed.key, original.key);
  assert.notEqual(changed.regions[0].name, original.regions[0].name);
});

test("Road Crew pack detection does not claim unrelated Mapbox packs", () => {
  assert.equal(isRoadCrewOfflinePack("rc-route-map-v1-day1", null), true);
  assert.equal(isRoadCrewOfflinePack("other-app", { app: "road-crew" }), true);
  assert.equal(isRoadCrewOfflinePack("other-app", { app: "someone-else" }), false);
  assert.equal(OFFLINE_TILE_LIMIT, 750);
});

test("offline retries back off and cap at 30 seconds", () => {
  assert.equal(offlineMapRetryDelay(0), 2_000);
  assert.equal(offlineMapRetryDelay(1), 5_000);
  assert.equal(offlineMapRetryDelay(2), 15_000);
  assert.equal(offlineMapRetryDelay(99), 30_000);
});

test("offline retry classification catches intermittent transport failures", () => {
  assert.equal(isOfflineMapTransientError(new Error("The network connection was lost.")), true);
  assert.equal(isOfflineMapTransientError(new Error("Request timed out")), true);
  assert.equal(isOfflineMapTransientError(new Error("Style JSON is malformed")), false);
});
