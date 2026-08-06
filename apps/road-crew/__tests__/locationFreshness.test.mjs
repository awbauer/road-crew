import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LOCATION_REFRESH_AGE_MS,
  shouldRefreshLocation,
} from "../src/field/locationFreshness.ts";

test("location freshness requests an initial fix", () => {
  assert.equal(shouldRefreshLocation(null, 100_000), true);
});

test("location freshness refreshes before the status becomes stale", () => {
  const now = 100_000;
  assert.equal(shouldRefreshLocation(now - LOCATION_REFRESH_AGE_MS + 1, now), false);
  assert.equal(shouldRefreshLocation(now - LOCATION_REFRESH_AGE_MS, now), true);
});

test("location freshness rejects invalid timestamps", () => {
  assert.equal(shouldRefreshLocation(Number.NaN, 100_000), true);
});
