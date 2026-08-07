import assert from "node:assert/strict";
import test from "node:test";

import { retainRecentUpdateNotifications } from "../src/notifications/archivePolicy.ts";

function notification(id, type, createdMs) {
  return {
    id,
    type,
    severity: "info",
    target: { scope: "global", value: null },
    title: type === "app-update" ? "App updated" : id,
    body: id,
    pinned: false,
    action: null,
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: null,
    createdMs,
    expiresMs: null,
    source: type === "app-update" ? "local" : "remote",
    read: true,
    firstSeenAt: createdMs,
  };
}

test("update history keeps only the two most recent update notices", () => {
  const archive = {
    old: notification("old", "app-update", 1),
    middle: notification("middle", "app-update", 2),
    newest: notification("newest", "app-update", 3),
    message: notification("message", "message", 1),
  };

  assert.deepEqual(Object.keys(retainRecentUpdateNotifications(archive)).sort(), ["message", "middle", "newest"]);
});
