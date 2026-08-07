import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseNativeAnimationDriver } from "../src/ui/animationDriver.ts";

test("native Fabric platforms avoid the JS-driven setNativeProps path", () => {
  assert.equal(shouldUseNativeAnimationDriver("ios"), true);
  assert.equal(shouldUseNativeAnimationDriver("android"), true);
});

test("web keeps the JavaScript animation fallback", () => {
  assert.equal(shouldUseNativeAnimationDriver("web"), false);
});
