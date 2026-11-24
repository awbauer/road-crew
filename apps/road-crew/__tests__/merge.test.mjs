// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { highestServerSeq, unreadCount } from "../src/sync/merge.js";

/** @typedef {import("@road-crew/contracts").ClientMessage} ClientMessage */

/**
 * @param {number} seq
 * @param {Partial<ClientMessage>} [overrides]
 * @returns {ClientMessage}
 */
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

/**
 * @param {string} cid
 * @param {string} createdAtClient
 * @returns {ClientMessage}
 */
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
