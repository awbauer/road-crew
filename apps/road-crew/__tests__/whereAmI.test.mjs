import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWhereAmIText,
  buildWhereAmIView,
  cardinalDirection,
  closestIntersection,
  formatIntersectionDistance,
  formatSequencePosition,
  hasHouseNumber,
  houseNumberedStreet,
  locationQuality,
  parseIntersectionName,
  resolveHeading,
  resolveLocalWhereAmI,
  shouldReuseCachedAddress,
} from "../../../packages/core/src/whereAmI.ts";

// A short synthetic route heading east along latitude 42: each 0.001 of
// longitude is roughly 83 m at this latitude.
const SEQUENCES = [
  {
    seq: 220,
    street: "High St",
    town: "Medfield",
    intersection: "High St & Route 27, Medfield",
    lat: 42.0,
    lng: -71.002,
  },
  {
    seq: 221,
    street: "Seekonk St",
    town: "Norfolk",
    intersection: "Seekonk St & Union St, Norfolk",
    lat: 42.0,
    lng: -71.001,
  },
  {
    seq: 222,
    street: "Needham St",
    town: "Norfolk",
    intersection: "123 Needham St, Norfolk",
    lat: 42.0,
    lng: -71.0,
  },
];

const ROUTE = { sequences: SEQUENCES };

function fixAt(lng, overrides = {}) {
  return { lat: 42.0, lng, accuracy: 8, speed: 10, heading: 90, ts: Date.now(), ...overrides };
}

test("only authored crossings count as intersections", () => {
  assert.equal(parseIntersectionName("Seekonk St & Union St, Norfolk"), "Seekonk St & Union St");
  // A plain address is a sequence location, not a junction.
  assert.equal(parseIntersectionName("123 Needham St, Norfolk"), null);
  // Same street on both sides is a segmentation point on one road.
  assert.equal(parseIntersectionName("Main St & Main St"), null);
  assert.equal(parseIntersectionName(null), null);
});

test("three-road junctions read as a list with a final ampersand", () => {
  assert.equal(
    parseIntersectionName("Seekonk St & Union St & Main St, Norfolk"),
    "Seekonk St, Union St & Main St",
  );
});

test("a comma inside the first street name doesn't truncate the crossing", () => {
  // Real bundled-data bug: splitting the whole string on its first comma cut
  // this off right after "Main St.,", losing "& North St." and the town
  // entirely, so a real intersection silently read as unavailable.
  assert.equal(
    parseIntersectionName("Main St., (Rt. 109) & North St.,, Medfield"),
    "Main St. (Rt. 109) & North St.",
  );
  assert.equal(
    parseIntersectionName("North St., & Harding St., Medfield"),
    "North St. & Harding St.",
  );
});

test("closest intersection is the geographically nearest, not the next one along", () => {
  // Sitting just east of seq 221, so 221's crossing is closest even though 222
  // is the next sequence ahead.
  const match = closestIntersection(SEQUENCES, 42.0, -71.0009);
  assert.equal(match.name, "Seekonk St & Union St");
  assert.equal(match.seq, 221);
  assert.ok(match.distanceMeters < 20);
});

test("intersections beyond the search radius are not returned", () => {
  assert.equal(closestIntersection(SEQUENCES, 42.5, -71.0), null);
  assert.equal(closestIntersection([], 42.0, -71.0), null);
});

test("cardinal directions cover the wrap around north", () => {
  assert.equal(cardinalDirection(0), "North");
  assert.equal(cardinalDirection(350), "North");
  assert.equal(cardinalDirection(45), "Northeast");
  assert.equal(cardinalDirection(180), "South");
  assert.equal(cardinalDirection(315), "Northwest");
  assert.equal(cardinalDirection(null), null);
});

test("heading is only reported while the van is actually moving", () => {
  assert.equal(resolveHeading(fixAt(-71.001)).cardinal, "East");
  assert.equal(resolveHeading(fixAt(-71.001, { speed: 0.2 })), null);
  assert.equal(resolveHeading(fixAt(-71.001, { heading: -1 })), null);
  assert.equal(resolveHeading(fixAt(-71.001, { speed: null })), null);
});

test("intersection distance reads as proximity, never as direction", () => {
  assert.equal(formatIntersectionDistance(5), "At intersection");
  assert.equal(formatIntersectionDistance(73), "240 ft away");
  assert.equal(formatIntersectionDistance(500), "0.3 mi away");
  assert.equal(formatIntersectionDistance(null), null);
});

test("a confident match names the bracketing pair, a loose one reads as off route", () => {
  assert.equal(formatSequencePosition({ fromSequence: 221, toSequence: 222, nearestSequence: 221, confidence: "high" }), "Between 221 & 222");
  assert.equal(formatSequencePosition({ fromSequence: null, toSequence: null, nearestSequence: 221, confidence: "low" }), "Off Route");
  assert.equal(formatSequencePosition(null), null);
});

test("on route, town, street and sequence pair all resolve offline", () => {
  const result = resolveLocalWhereAmI(fixAt(-71.0007), ROUTE);
  assert.equal(result.town, "Norfolk");
  assert.equal(result.street, "Seekonk St");
  assert.equal(result.sequence.fromSequence, 221);
  assert.equal(result.sequence.toSequence, 222);
  assert.equal(result.sequence.confidence, "high");
  assert.equal(result.intersection.name, "Seekonk St & Union St");
  assert.equal(result.heading.cardinal, "East");
});

test("off route, no sequence pair or street is invented", () => {
  // ~550 m north of the route.
  const result = resolveLocalWhereAmI(fixAt(-71.001, { lat: 42.005 }), ROUTE);
  assert.equal(result.street, null);
  assert.equal(result.sequence.fromSequence, null);
  assert.equal(result.sequence.toSequence, null);
  assert.equal(result.sequence.nearestSequence, 221);
  assert.equal(result.sequence.confidence, "low");
  // Still in range of the route's town data.
  assert.equal(result.town, "Norfolk");
});

test("a fix far from every route keeps coordinates and drops the bundled town", () => {
  const result = resolveLocalWhereAmI(fixAt(-71.5, { lat: 42.6 }), ROUTE);
  assert.equal(result.town, null);
  assert.equal(result.intersection, null);
  assert.equal(result.coordinate.lat, 42.6);
});

test("stale and inaccurate fixes are flagged", () => {
  const now = Date.now();
  const fresh = locationQuality({ ...fixAt(-71.001), ts: now }, now);
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.isLowAccuracy, false);

  const stale = locationQuality({ ...fixAt(-71.001), ts: now - 45_000 }, now);
  assert.equal(stale.isStale, true);
  assert.equal(stale.needsRefresh, false);

  const ancient = locationQuality({ ...fixAt(-71.001), ts: now - 200_000, accuracy: 140 }, now);
  assert.equal(ancient.needsRefresh, true);
  assert.equal(ancient.isPoorAccuracy, true);
});

test("the geocoded town and street win, since route data is only granular at cues", () => {
  const local = resolveLocalWhereAmI(fixAt(-71.0007), ROUTE);
  const view = buildWhereAmIView(
    local,
    { formatted: "123 Union St, Norfolk, MA 02056", street: "Union St", locality: "Norfolk" },
    "available",
  );
  assert.equal(view.town, "Norfolk");
  assert.equal(view.townSource, "address");
  // The route says Seekonk St because that is where the last cue sent you; the
  // geocoder knows which road the van is actually on. Mapbox answered with a
  // street-level feature (no number in `street`), so the number comes off the
  // formatted address — without dragging the town and state onto the card's
  // largest line.
  assert.equal(view.street, "123 Union St");
  assert.equal(view.streetSource, "address");
  assert.equal(view.fullAddress, "123 Union St, Norfolk, MA 02056");
});

test("route data is the fallback when the lookup fails or returns nothing", () => {
  const local = resolveLocalWhereAmI(fixAt(-71.0007), ROUTE);
  const offline = buildWhereAmIView(local, null, "unavailable");
  assert.equal(offline.town, "Norfolk");
  assert.equal(offline.townSource, "route");
  assert.equal(offline.street, "Seekonk St");
  assert.equal(offline.streetSource, "route");

  // The web build never asks, so the status stays "notRequested" and the panel
  // has nothing to put in the address row.
  const noGeocoder = buildWhereAmIView(local, null, "notRequested");
  assert.equal(noGeocoder.town, "Norfolk");
  assert.equal(noGeocoder.street, "Seekonk St");
  assert.equal(noGeocoder.fullAddress, null);
  assert.equal(noGeocoder.addressStatus, "notRequested");

  // A partial result only fills what it actually carries.
  const partial = buildWhereAmIView(local, { formatted: "Norfolk, MA", street: null, locality: null }, "available");
  assert.equal(partial.streetSource, "route");
  assert.equal(partial.townSource, "route");
  assert.equal(partial.fullAddress, "Norfolk, MA");
});

test("the modal still resolves without any route loaded", () => {
  const view = buildWhereAmIView(resolveLocalWhereAmI(fixAt(-71.001), null), null, "unavailable");
  assert.equal(view.sequence, null);
  assert.equal(view.intersection, null);
  assert.equal(view.coordinateLabel, "42.00000, -71.00100");
});

test("copy text omits unavailable fields", () => {
  const view = buildWhereAmIView(resolveLocalWhereAmI(fixAt(-71.0007), ROUTE), null, "unavailable");
  const text = buildWhereAmIText(view, { relativeTime: "19s ago" });
  assert.match(text, /^Town: Norfolk$/m);
  assert.match(text, /^Closest intersection: Seekonk St & Union St$/m);
  assert.match(text, /^Sequence: Between 221 & 222$/m);
  assert.match(text, /^Last updated: 19s ago$/m);
  // No address resolved, so no address line at all — not a placeholder.
  assert.ok(!text.includes("Address:"));
});

test("cached addresses are reused within 100 yards, whatever their age", () => {
  const now = Date.now();
  const cached = { formatted: "x", street: null, locality: null, lat: 42.0, lng: -71.0, timestampMs: now };
  // ~55 m away, inside the 91.44 m radius.
  assert.equal(shouldReuseCachedAddress(cached, 42.0005, -71.0), true);
  // ~111 m away, outside it.
  assert.equal(shouldReuseCachedAddress(cached, 42.001, -71.0), false);
  // Age alone never invalidates an entry — an address is a fact about a place.
  assert.equal(shouldReuseCachedAddress({ ...cached, timestampMs: now - 30 * 86_400_000 }, 42.0, -71.0), true);
  assert.equal(shouldReuseCachedAddress(null, 42.0, -71.0), false);
});

test("the street line takes a house number from the formatted address when it has one", () => {
  const local = resolveLocalWhereAmI(fixAt(-71.0007), ROUTE);

  // Mapbox already put the number in `street` (an "address" feature): the
  // formatted address is not consulted, so the card keeps the specific value.
  const addressFeature = buildWhereAmIView(
    local,
    { formatted: "350 Greenwood St, Millbury, Massachusetts 01527", street: "350 Greenwood St", locality: "Millbury" },
    "available",
  );
  assert.equal(addressFeature.street, "350 Greenwood St");

  // A hyphenated range and a unit letter are both house numbers.
  for (const [formatted, expected] of [
    ["12-14 Main St, Medfield, MA", "12-14 Main St"],
    ["1A Elm St, Medfield, MA", "1A Elm St"],
  ]) {
    const view = buildWhereAmIView(local, { formatted, street: "Main St", locality: "Medfield" }, "available");
    assert.equal(view.street, expected);
  }

  // An ordinal road name is not a house number. Falling back here would be a
  // no-op at best and misleading at worst, so the geocoded street stands.
  const ordinal = buildWhereAmIView(
    local,
    { formatted: "1st Avenue, Medfield, MA", street: "1st Avenue", locality: "Medfield" },
    "available",
  );
  assert.equal(ordinal.street, "1st Avenue");

  // Nothing numbered anywhere: unchanged behavior, the geocoded street wins.
  const unnumbered = buildWhereAmIView(
    local,
    { formatted: "Union St, Norfolk, MA", street: "Union St", locality: "Norfolk" },
    "available",
  );
  assert.equal(unnumbered.street, "Union St");

  // The number can arrive with no street field at all. The value is then still
  // address-derived, so the source must not claim the route supplied it.
  const numberOnly = buildWhereAmIView(
    local,
    { formatted: "77 Union St, Norfolk, MA", street: null, locality: "Norfolk" },
    "available",
  );
  assert.equal(numberOnly.street, "77 Union St");
  assert.equal(numberOnly.streetSource, "address");
});

test("house number detection distinguishes addresses from ordinal road names", () => {
  for (const numbered of ["350 Greenwood St", "12-14 Main St", "1A Elm St", "  7 Oak Ave"]) {
    assert.equal(hasHouseNumber(numbered), true, numbered);
  }
  for (const plain of ["1st Avenue", "3rd St", "Union St", "", null, undefined, "42"]) {
    assert.equal(hasHouseNumber(plain), false, String(plain));
  }
  assert.equal(houseNumberedStreet("350 Greenwood St, Millbury, MA"), "350 Greenwood St");
  assert.equal(houseNumberedStreet("Union St, Norfolk, MA"), null);
  assert.equal(houseNumberedStreet(null), null);
});
