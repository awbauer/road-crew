import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveHeartbeatTrackingState,
  shouldShowTrackingControl,
} from "../src/field/trackingPolicy.ts";

test("the Worker shutdown overrides local state and an enable command", () => {
  assert.deepEqual(resolveHeartbeatTrackingState({
    currentAllowed: true,
    currentTrackingEnabled: true,
    serverAllowsTracking: false,
    commandedTrackingEnabled: true,
  }), {
    locationTrackingAllowed: false,
    remoteTrackingEnabled: false,
  });
});

test("removing the shutdown unlocks tracking without silently resuming it", () => {
  assert.deepEqual(resolveHeartbeatTrackingState({
    currentAllowed: false,
    currentTrackingEnabled: false,
    serverAllowsTracking: true,
  }), {
    locationTrackingAllowed: true,
    remoteTrackingEnabled: false,
  });
});

test("older responses preserve the last persisted server policy", () => {
  assert.deepEqual(resolveHeartbeatTrackingState({
    currentAllowed: false,
    currentTrackingEnabled: true,
  }), {
    locationTrackingAllowed: false,
    remoteTrackingEnabled: false,
  });
});

test("the Tracked control is hidden while server policy disables it", () => {
  assert.equal(shouldShowTrackingControl(true, false), false);
  assert.equal(shouldShowTrackingControl(true, true), true);
  assert.equal(shouldShowTrackingControl(false, true), false);
});
