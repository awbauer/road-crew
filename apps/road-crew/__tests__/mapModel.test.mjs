import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteMapModel,
  CUMBERLAND_FARMS_LAYER_ID,
  coordinateBounds,
  DEFAULT_CUMBERLAND_FARMS_VISIBLE,
  imperialScaleIndicator,
  mapLayerControlItems,
  mapSequenceFlags,
  reconcileMapLayerVisibility,
  routeLayerVisibility,
  routeMapCoordinates,
  sequenceFromMapProperties,
  sequenceMapPopupDetails,
  sequenceNumberRange,
} from "../src/field/mapModel.ts";

test("Cumberland Farms starts hidden on both map adapters", () => {
  assert.equal(DEFAULT_CUMBERLAND_FARMS_VISIBLE, false);
});

test("only the active visible route can show sequence labels", () => {
  assert.deepEqual(routeLayerVisibility("active", "active", true), {
    labels: true,
    path: true,
    points: true,
  });
  assert.deepEqual(routeLayerVisibility("inactive", "active", true), {
    labels: false,
    path: true,
    points: true,
  });
  assert.deepEqual(routeLayerVisibility("active", "active", false), {
    labels: false,
    path: false,
    points: false,
  });
});

test("map layer controls and visibility policy are shared by web and native", () => {
  const routeLayers = [
    { id: "layer-sat", routeId: "sat", routeName: "Saturday" },
    { id: "layer-sun", routeId: "sun", routeName: "Sunday" },
  ];
  assert.deepEqual(mapLayerControlItems(routeLayers), [
    { id: "layer-sat", kind: "route", label: "Saturday", routeId: "sat" },
    { id: "layer-sun", kind: "route", label: "Sunday", routeId: "sun" },
    { id: CUMBERLAND_FARMS_LAYER_ID, kind: "cumbys", label: "Cumbys w/gas" },
  ]);

  assert.deepEqual(
    reconcileMapLayerVisibility(
      { "layer-sat": false, "layer-sun": false, stale: true },
      routeLayers,
      "sun",
      true,
    ),
    { "layer-sat": false, "layer-sun": true, [CUMBERLAND_FARMS_LAYER_ID]: true },
  );
});

test("imperial map scale stays within its control at local and regional zooms", () => {
  const local = imperialScaleIndicator(14, 42, 96);
  const regional = imperialScaleIndicator(7, 42, 96);
  assert.match(local.label, / ft$/);
  assert.match(regional.label, / mi$/);
  for (const scale of [local, regional]) {
    assert.ok(scale.width > 0);
    assert.ok(scale.width <= 96);
  }
});

const route = {
  id: "sat-1",
  name: "Saturday Route",
  path: [
    [-71.2, 42.3],
    [Number.NaN, 42.4],
    [-71.0, 42.1],
  ],
  sequences: [
    {
      seq: 10,
      lat: 42.3,
      lng: -71.2,
      street: "Main St",
      town: "Wellesley",
      num_first: 5,
      num_last: 9,
      miles: 1.25,
      first_rider_time: "8:10 AM",
      last_rider_time: "5:45 PM",
      police: true,
      water_stop: true,
    },
    { seq: 11, lat: 42.1, lng: -71.0, street: "Oak St" },
  ],
};

test("route map coordinates sanitize path data and fall back to sequences", () => {
  assert.deepEqual(routeMapCoordinates(route), [
    [-71.2, 42.3],
    [-71.0, 42.1],
  ]);

  assert.deepEqual(
    routeMapCoordinates({ ...route, path: [[Number.NaN, 42], [-71, Number.NaN]] }),
    [
      [-71.2, 42.3],
      [-71.0, 42.1],
    ],
  );
});

test("route map model centralizes active route, bounds, and sequence properties", () => {
  const secondRoute = {
    id: "sun-1",
    sequences: [{ seq: 20, lat: 41.9, lng: -70.6, road_crew: true }],
  };
  const model = buildRouteMapModel([route, secondRoute], "sun-1");

  assert.equal(model.activeRouteId, "sun-1");
  assert.equal(model.activeBounds.ne[0].toFixed(2), "-70.59");
  assert.equal(model.activeBounds.ne[1].toFixed(2), "41.91");
  assert.equal(model.activeBounds.sw[0].toFixed(2), "-70.61");
  assert.equal(model.activeBounds.sw[1].toFixed(2), "41.89");
  assert.equal(model.routes[0].sequences[0].properties.routeName, "Saturday Route");
  assert.equal(model.routes[0].sequences[0].properties.water_stop, true);
  assert.equal(model.routes[0].sequences[0].properties.distanceToNextLabel, "1.25 mi");
  assert.equal(model.routes[0].sequences[0].properties.riderTimesLabel, "8:10 AM – 5:45 PM");
  assert.equal(model.routes[1].sequences[0].properties.road_crew, true);
  assert.ok(model.allCoordinates.length >= 5);
});

test("sequence popup details keep rider times and distance on sequences", () => {
  assert.deepEqual(sequenceMapPopupDetails(route.sequences, 0), {
    distanceToNextLabel: "1.25 mi",
    riderTimesLabel: "8:10 AM – 5:45 PM",
  });
  assert.deepEqual(sequenceMapPopupDetails(route.sequences, 1), {
    distanceToNextLabel: null,
    riderTimesLabel: null,
  });
});

test("route map model falls back to the first route for an unknown active id", () => {
  const model = buildRouteMapModel([route], "missing");
  assert.equal(model.activeRouteId, route.id);
});

test("map sequence popup helpers preserve flags and one-sided number ranges", () => {
  const sequence = sequenceFromMapProperties({
    seq: "42",
    num_last: "17",
    street: "Pine St",
    police: "true",
    mh_sign: 1,
  });
  assert.equal(sequence.seq, 42);
  assert.equal(sequenceNumberRange(sequence), "17");
  assert.deepEqual(mapSequenceFlags(sequence), ["Police", "MH Sign"]);
  assert.equal(sequenceFromMapProperties({ cum_miles: "not-a-number" }).cum_miles, null);
});

test("coordinate bounds support optional camera padding", () => {
  assert.deepEqual(coordinateBounds([[-71, 42], [-70, 41]], 0.1), {
    ne: [-69.9, 42.1],
    sw: [-71.1, 40.9],
  });
  assert.equal(coordinateBounds([]), null);
});
