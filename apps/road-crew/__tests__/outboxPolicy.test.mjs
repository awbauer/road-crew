// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { outboxFailureStatus } from "../src/sync/outboxPolicy.ts";

test("outbox keeps offline and transient failures queued", () => {
  assert.equal(outboxFailureStatus(new Error("Failed to fetch"), false), "queued");
  assert.equal(outboxFailureStatus(new Error("Request timed out"), true), "queued");
  assert.equal(outboxFailureStatus({ status: 503 }, true), "queued");
});

test("outbox exposes permanent online failures for user intervention", () => {
  assert.equal(outboxFailureStatus({ status: 400 }, true), "failed");
  assert.equal(outboxFailureStatus(new Error("Message rejected"), true), "failed");
});
