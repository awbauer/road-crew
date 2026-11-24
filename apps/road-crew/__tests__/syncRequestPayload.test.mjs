// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";

import { readAnySyncRequestId, readSyncRequest } from "../src/push/syncRequestPayload.js";

const SYNC_ID = "7d7b0920-8ff6-4285-80f4-157f1069e008";

/**
 * What the Worker sends (its buildSilentCommandPushPayload), run
 * through expo-notifications' iOS BackgroundEventTransformer: every key except
 * `aps` is nested under `data`, and `dataString` is null because the payload
 * carries no `body`. Reading the outer object instead of this one is the bug
 * that discarded every silent wake fleet-wide.
 */
function iosTransformed(syncRequestId = SYNC_ID) {
  return {
    data: { type: "sync-request", syncRequestId, dataString: null },
    notification: null,
    aps: { "content-available": 1 },
  };
}

test("the iOS transformer's nested payload resolves to a sync request", () => {
  assert.deepEqual(readSyncRequest(iosTransformed()), {
    type: "sync-request",
    syncRequestId: SYNC_ID,
  });
});

test("a flat payload still resolves, so a changed wrapper degrades instead of dropping the wake", () => {
  const flat = { type: "sync-request", syncRequestId: SYNC_ID, aps: { "content-available": 1 } };
  assert.deepEqual(readSyncRequest(flat), { type: "sync-request", syncRequestId: SYNC_ID });
});

test("only a sync-request is claimed", () => {
  assert.equal(readSyncRequest({ data: { type: "something-else", syncRequestId: SYNC_ID } }), null);
  assert.equal(readSyncRequest({ data: { type: "sync-request" } }), null, "an id is required");
  assert.equal(readSyncRequest({ data: { type: "sync-request", syncRequestId: "   " } }), null);
  assert.equal(readSyncRequest({ data: { type: "sync-request", syncRequestId: 7 } }), null);
  assert.equal(readSyncRequest(null), null);
  assert.equal(readSyncRequest("nope"), null);
  assert.equal(readSyncRequest({}), null);
});

test("the id is recoverable from a payload that is not a sync request", () => {
  // An unrecognized wake still acknowledges, so a shape change is visible in
  // Command rather than silently indistinguishable from an undelivered push.
  assert.equal(readAnySyncRequestId({ data: { type: "future-type", syncRequestId: SYNC_ID } }), SYNC_ID);
  assert.equal(readAnySyncRequestId(iosTransformed()), SYNC_ID);
  assert.equal(readAnySyncRequestId({ data: { type: "future-type" } }), null);
  assert.equal(readAnySyncRequestId(null), null);
});

test("surrounding whitespace on the id is trimmed", () => {
  assert.equal(readSyncRequest({ data: { type: "sync-request", syncRequestId: `  ${SYNC_ID}  ` } })?.syncRequestId, SYNC_ID);
});
