import test from "node:test";
import assert from "node:assert/strict";

import { isRemoteBuildNewer } from "../src/update/versionComparison.js";

test("automatic updates only run for a newer published build", () => {
  assert.equal(isRemoteBuildNewer("17840743", "17840744"), true);
  assert.equal(isRemoteBuildNewer("17840743", "17840743"), false);
  assert.equal(isRemoteBuildNewer("17840743", "17840742"), false);
  assert.equal(isRemoteBuildNewer("", "17840744"), false);
});

test("version comparison keeps a numeric-aware fallback", () => {
  assert.equal(isRemoteBuildNewer("build-9", "build-10"), true);
  assert.equal(isRemoteBuildNewer("build-10", "build-9"), false);
});
