import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOLLOW_PAUSE_MS,
  isFollowAutoScrollPaused,
} from "../src/field/followPause.ts";

test("follow pause lasts a full 12 seconds after manual scrolling ends", () => {
  const endedAt = 100_000;
  assert.equal(isFollowAutoScrollPaused(endedAt, endedAt), true);
  assert.equal(isFollowAutoScrollPaused(endedAt, endedAt + FOLLOW_PAUSE_MS - 1), true);
  assert.equal(isFollowAutoScrollPaused(endedAt, endedAt + FOLLOW_PAUSE_MS), false);
});

test("follow pause is inactive before any manual scroll", () => {
  assert.equal(isFollowAutoScrollPaused(0, 100_000), false);
});
