import { test } from "node:test";
import assert from "node:assert/strict";

import { computeGpsStatus } from "../src/field/gpsStatus.ts";

test("GPS status exposes heading and whole-number MPH labels", () => {
  const status = computeGpsStatus({
    lat: 42.3,
    lng: -71.2,
    speed: 2,
    heading: 91.6,
    accuracy: 5,
    ts: Date.now(),
  }, undefined);

  assert.equal(status.headingLabel, "E");
  assert.equal(status.speedLabel, "4 mph");
});

test("GPS status uses placeholders while acquiring a fix", () => {
  const status = computeGpsStatus(null, undefined);
  assert.equal(status.headingLabel, "—");
  assert.equal(status.speedLabel, "—");
});

// An east-west path along a line of constant latitude, so a fix offset due
// north sits a known distance from the polyline. 1° of latitude ≈ 111_320 m.
const BASE_LAT = 42.3;
const METERS_PER_DEG_LAT = 111_320;
const straightRoute = {
  id: "test_route",
  sequences: [
    { seq: 1, lat: BASE_LAT, lng: -71.21, street: "First St", town: "Testville" },
    { seq: 2, lat: BASE_LAT, lng: -71.2, street: "Second St", town: "Testville" },
    { seq: 3, lat: BASE_LAT, lng: -71.19, street: "Third St", town: "Testville" },
  ],
  path: [
    [-71.21, BASE_LAT],
    [-71.19, BASE_LAT],
  ],
};

/** A fix `meters` due north of the midpoint of `straightRoute`. */
function fixOffsetNorth(meters, accuracy = 5) {
  return {
    lat: BASE_LAT + meters / METERS_PER_DEG_LAT,
    lng: -71.2,
    speed: 5,
    heading: 90,
    accuracy,
    ts: Date.now(),
  };
}

test("a fix inside the corridor reads as on route", () => {
  const status = computeGpsStatus(fixOffsetNorth(25), straightRoute);
  assert.equal(status.onRoute, true);
  assert.equal(status.statusLabel, "On route");
  // On route hides the distance-back-to-route readout.
  assert.equal(status.distanceLabel, null);
});

test("a fix beyond the corridor reads as off route with a distance back", () => {
  const status = computeGpsStatus(fixOffsetNorth(120), straightRoute);
  assert.equal(status.onRoute, false);
  assert.equal(status.statusLabel, "Off route");
  assert.notEqual(status.distanceLabel, null);
});

test("with no prior state the corridor uses the tighter 50 m threshold", () => {
  assert.equal(computeGpsStatus(fixOffsetNorth(48), straightRoute, null).onRoute, true);
  assert.equal(computeGpsStatus(fixOffsetNorth(52), straightRoute, null).onRoute, false);
});

test("on route holds until the fix passes the outer 80 m threshold", () => {
  // Inside the 50-80 m dead band, an on-route van stays on route.
  assert.equal(computeGpsStatus(fixOffsetNorth(65), straightRoute, true).onRoute, true);
  assert.equal(computeGpsStatus(fixOffsetNorth(78), straightRoute, true).onRoute, true);
  // Past the outer threshold it flips.
  assert.equal(computeGpsStatus(fixOffsetNorth(82), straightRoute, true).onRoute, false);
});

test("off route holds until the fix comes back inside the inner 50 m threshold", () => {
  // The same dead band keeps an off-route van off route.
  assert.equal(computeGpsStatus(fixOffsetNorth(65), straightRoute, false).onRoute, false);
  assert.equal(computeGpsStatus(fixOffsetNorth(52), straightRoute, false).onRoute, false);
  // Back inside the inner threshold it recovers.
  assert.equal(computeGpsStatus(fixOffsetNorth(48), straightRoute, false).onRoute, true);
});

test("hysteresis stops a fix jittering across one threshold from flapping", () => {
  // A van parked ~65 m out, jittering either side of a single 50 m line, would
  // flip on every fix without the dead band. Here the state is whatever it was.
  for (const distance of [60, 70, 63, 72, 66]) {
    assert.equal(computeGpsStatus(fixOffsetNorth(distance), straightRoute, true).onRoute, true);
    assert.equal(computeGpsStatus(fixOffsetNorth(distance), straightRoute, false).onRoute, false);
  }
});

test("a fix less accurate than 100 yards is rejected instead of judged", () => {
  // Sitting right on the route, but with an error wider than the corridor.
  const status = computeGpsStatus(fixOffsetNorth(0, 150), straightRoute, true);
  assert.equal(status.onRoute, null);
  assert.equal(status.accuracyRejected, true);
  assert.equal(status.statusLabel, "Weak GPS");
  // The precision-dependent blink is suppressed...
  assert.equal(status.withinBlink, false);
  // ...but the coarse next/prev bar still reads.
  assert.notEqual(status.nextSeqNum, null);
});

test("an accurate fix is judged normally and reports no accuracy problem", () => {
  const status = computeGpsStatus(fixOffsetNorth(0, 8), straightRoute, null);
  assert.equal(status.onRoute, true);
  assert.equal(status.accuracyRejected, false);
});

test("an unreported accuracy is taken at face value rather than discarded", () => {
  const status = computeGpsStatus(fixOffsetNorth(10, null), straightRoute, null);
  assert.equal(status.onRoute, true);
  assert.equal(status.accuracyRejected, false);
});
