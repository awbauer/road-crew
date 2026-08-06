import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLEET_BUCKET_COLOR,
  FLEET_CLUSTER_COLOR,
  FLEET_CLUSTER_TEXT_COLOR,
  FLEET_FRESH_MS,
  FLEET_STALE_MS,
  describeFleetMarker,
  fixAgeBucket,
  formatFleetLastSeen,
  selectFleet,
} from "../src/field/fleet.js";

test("fleet colors use one contrasting orange family across markers and clusters", () => {
  assert.deepEqual(FLEET_BUCKET_COLOR, {
    fresh: "#ff8c00",
    stale: "#d96800",
    old: "#925a2c",
  });
  assert.equal(FLEET_CLUSTER_COLOR, FLEET_BUCKET_COLOR.fresh);
  assert.equal(FLEET_CLUSTER_TEXT_COLOR, "#1a1a1a");
  assert.equal(new Set(Object.values(FLEET_BUCKET_COLOR)).size, 3);
});

test("fixAgeBucket buckets by 10min / 30min thresholds", () => {
  assert.equal(fixAgeBucket(0), "fresh");
  assert.equal(fixAgeBucket(FLEET_FRESH_MS - 1), "fresh");
  assert.equal(fixAgeBucket(FLEET_FRESH_MS), "stale");
  assert.equal(fixAgeBucket(FLEET_STALE_MS - 1), "stale");
  assert.equal(fixAgeBucket(FLEET_STALE_MS), "old");
  assert.equal(fixAgeBucket(Number.NaN), "old");
  assert.equal(fixAgeBucket(-5), "old");
});

test("formatFleetLastSeen renders useful fix ages", () => {
  assert.equal(formatFleetLastSeen(15_000), "<1m ago");
  assert.equal(formatFleetLastSeen(12 * 60_000), "12m ago");
  assert.equal(formatFleetLastSeen(2 * 60 * 60_000), "2h ago");
  assert.equal(formatFleetLastSeen(3 * 24 * 60 * 60_000), "3d ago");
  assert.equal(formatFleetLastSeen(Number.NaN), "Unknown");
});

test("selectFleet excludes the viewer's own van by id", () => {
  const now = 1_000_000;
  const list = [
    { vanId: "VAN-1", lat: 41, lng: -70, ts: now, deviceId: "d_1" },
    { vanId: "VAN-2", lat: 42, lng: -71, ts: now, deviceId: "d_2" },
  ];
  const out = selectFleet(list, { selfVanId: "VAN-1", now });
  assert.deepEqual(out.map((v) => v.vanId), ["VAN-2"]);
});

test("selectFleet excludes the viewer's own reporting device", () => {
  const now = 1_000_000;
  const list = [
    { vanId: "VAN-5", lat: 41, lng: -70, ts: now, deviceId: "d_self" },
  ];
  assert.equal(selectFleet(list, { selfDeviceId: "d_self", now }).length, 0);
});

test("selectFleet drops entries with bad coordinates and annotates age", () => {
  const now = 2_000_000;
  const list = [
    { vanId: "VAN-3", lat: 999, lng: -70, ts: now }, // bad lat
    { vanId: "VAN-4", lat: 41, lng: -70, heading: null, ts: now - FLEET_FRESH_MS }, // stale boundary
    { vanId: "", lat: 41, lng: -70, ts: now }, // no van id
  ];
  const out = selectFleet(list, { now });
  assert.equal(out.length, 1);
  assert.equal(out[0].vanId, "VAN-4");
  assert.equal(out[0].bucket, "stale");
  assert.equal(out[0].ageMs, FLEET_FRESH_MS);
  assert.equal(out[0].routeId, null);
  assert.equal(out[0].heading, null);
});

test("selectFleet tolerates non-array input", () => {
  assert.deepEqual(selectFleet(null), []);
  assert.deepEqual(selectFleet(undefined), []);
});

test("selectFleet preserves route and heading context", () => {
  const [marker] = selectFleet([{
    vanId: "VAN-8",
    routeId: "route-b",
    lat: 42,
    lng: -71,
    heading: 270,
    ts: 10,
  }], { now: 10 });
  assert.equal(marker.routeId, "route-b");
  assert.equal(marker.heading, 270);
});

test("describeFleetMarker uses the van's selected route without sequence details", () => {
  const marker = {
    vanId: "VAN-8",
    routeId: "route-b",
    lat: 42,
    lng: -71.001,
    heading: 90,
    ts: 10,
    ageMs: 0,
    bucket: "fresh",
  };
  const routes = [{
    id: "route-a",
    name: "Route A",
    sequences: [
      { seq: 1, lat: 41, lng: -72 },
      { seq: 2, lat: 41, lng: -71.99 },
    ],
  }, {
    id: "route-b",
    name: "Route B",
    sequences: [
      { seq: 10, lat: 42, lng: -71.002 },
      {
        seq: 11,
        lat: 42,
        lng: -71,
        first_rider_time: "8:10 AM",
        last_rider_time: "5:45 PM",
      },
    ],
  }];
  const details = describeFleetMarker(marker, routes);
  assert.equal(details.routeId, "route-b");
  assert.equal(details.routeName, "Route B");
  assert.deepEqual(Object.keys(details).sort(), ["routeId", "routeName"]);
});

test("describeFleetMarker falls back to the nearest route", () => {
  const marker = {
    vanId: "VAN-9",
    routeId: null,
    lat: 42,
    lng: -71.001,
    heading: 90,
    ts: 10,
    ageMs: 0,
    bucket: "fresh",
  };
  const routes = [{
    id: "far",
    name: "Far Route",
    sequences: [{ seq: 1, lat: 40, lng: -73 }, { seq: 2, lat: 40.01, lng: -73 }],
  }, {
    id: "near",
    name: "Near Route",
    sequences: [{ seq: 20, lat: 42, lng: -71.002 }, { seq: 21, lat: 42, lng: -71 }],
  }];
  assert.equal(describeFleetMarker(marker, routes).routeId, "near");
});
