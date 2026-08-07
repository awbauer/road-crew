import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TABLET_ROUTE_MIN_DIMENSION,
  usesTabletRouteWorkspace,
} from "../src/field/layout.ts";

test("the combined Route workspace requires tablet dimensions", () => {
  assert.equal(TABLET_ROUTE_MIN_DIMENSION, 768);
  assert.equal(usesTabletRouteWorkspace(1180, 820), true);
  assert.equal(usesTabletRouteWorkspace(820, 1180), true);
  assert.equal(usesTabletRouteWorkspace(1280, 720), false);
  assert.equal(usesTabletRouteWorkspace(390, 844), false);
});

test("a native tablet keeps the Route workspace in a compact app window", () => {
  assert.equal(usesTabletRouteWorkspace(744, 700, true), true);
  assert.equal(usesTabletRouteWorkspace(744, 700, false), false);
});
