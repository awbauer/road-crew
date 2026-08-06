import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMessages, highestServerSeq, unreadCount } from "../src/sync/merge.js";

function serverMsg(seq, overrides = {}) {
  return {
    id: `msg_${seq}`,
    clientMessageId: `cid_${seq}`,
    conversationId: "van:3",
    vanId: "3",
    senderType: "command",
    senderId: "command",
    body: `body ${seq}`,
    scope: "van",
    status: "sent",
    createdAtClient: `2026-06-05T00:00:0${seq}Z`,
    createdAtServer: `2026-06-05T00:00:0${seq}Z`,
    serverSeq: seq,
    ...overrides,
  };
}

function pending(cid, createdAtClient) {
  return {
    id: cid,
    clientMessageId: cid,
    conversationId: "van:3",
    vanId: "3",
    senderType: "van",
    senderId: "3",
    body: `pending ${cid}`,
    scope: "van",
    status: "queued",
    createdAtClient,
    createdAtServer: null,
    serverSeq: null,
  };
}

test("merge orders by serverSeq and dedupes by clientMessageId", () => {
  const merged = mergeMessages([serverMsg(1)], [serverMsg(2), serverMsg(1)]);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((m) => m.serverSeq),
    [1, 2],
  );
});

test("a server-confirmed echo replaces its queued local copy", () => {
  const local = pending("cid_5", "2026-06-05T00:00:05Z");
  const confirmed = serverMsg(5, { clientMessageId: "cid_5", senderType: "van", senderId: "3" });
  const merged = mergeMessages([local], [confirmed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "sent");
  assert.equal(merged[0].serverSeq, 5);
});

test("an unconfirmed re-send never clobbers an already-confirmed row", () => {
  const confirmed = serverMsg(7, { clientMessageId: "cid_7", senderType: "van" });
  const stale = pending("cid_7", "2026-06-05T00:00:07Z");
  const merged = mergeMessages([confirmed], [stale]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].serverSeq, 7);
  assert.equal(merged[0].status, "sent");
});

test("pending (null seq) messages sort after confirmed ones", () => {
  const merged = mergeMessages(
    [serverMsg(1)],
    [pending("cid_a", "2026-06-05T00:00:09Z"), pending("cid_b", "2026-06-05T00:00:08Z")],
  );
  assert.deepEqual(
    merged.map((m) => m.clientMessageId),
    ["cid_1", "cid_b", "cid_a"],
  );
});

test("maxLocalMessages keeps only the newest N", () => {
  const many = Array.from({ length: 10 }, (_, i) => serverMsg(i + 1));
  const merged = mergeMessages([], many, 3);
  assert.deepEqual(
    merged.map((m) => m.serverSeq),
    [8, 9, 10],
  );
});

test("highestServerSeq returns the max confirmed seq", () => {
  assert.equal(highestServerSeq([serverMsg(2), serverMsg(5), pending("x", "z")]), 5);
  assert.equal(highestServerSeq([]), 0);
});

test("unreadCount counts only inbound command messages past the read marker", () => {
  const messages = [
    serverMsg(1, { senderType: "command" }),
    serverMsg(2, { senderType: "command" }),
    serverMsg(3, { senderType: "van" }),
  ];
  assert.equal(unreadCount(messages, 1), 1);
  assert.equal(unreadCount(messages, 0), 2);
  assert.equal(unreadCount(messages, 3), 0);
});
