// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  FOREGROUND_SETTLE_MS,
  shouldCommitForegroundResult,
} from "../src/field/foregroundLifecycle.ts";

test("native UI accepts work completed in the same foreground epoch", () => {
  assert.equal(shouldCommitForegroundResult(true, true, 4, 4), true);
});

test("native UI rejects work completed while inactive", () => {
  assert.equal(shouldCommitForegroundResult(true, false, 4, 5), false);
});

test("native UI rejects work that crossed a lifecycle transition", () => {
  assert.equal(shouldCommitForegroundResult(true, true, 4, 6), false);
});

test("web responses are not coupled to React Native AppState", () => {
  assert.equal(shouldCommitForegroundResult(false, false, 4, 6), true);
});

test("foreground work waits for the native transition to settle", () => {
  assert.ok(FOREGROUND_SETTLE_MS >= 250);
});
