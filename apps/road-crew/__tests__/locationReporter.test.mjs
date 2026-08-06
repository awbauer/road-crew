import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REPORT_FIX_AGE_MS,
  isFixReportable,
  shouldAttachHeartbeatLocation,
} from "../src/field/locationReporter.js";

test("foreground heartbeat GPS requires a van install, a fix, and connectivity", () => {
  assert.equal(shouldAttachHeartbeatLocation({ vanInstall: true, hasFix: true, online: true }), true);
  assert.equal(shouldAttachHeartbeatLocation({ vanInstall: false, hasFix: true, online: true }), false);
  assert.equal(shouldAttachHeartbeatLocation({ vanInstall: true, hasFix: false, online: true }), false);
  assert.equal(shouldAttachHeartbeatLocation({ vanInstall: true, hasFix: true, online: false }), false);
});

test("a van install attaches foreground GPS before a van is selected", () => {
  assert.equal(shouldAttachHeartbeatLocation({ vanInstall: true, hasFix: true, online: true }), true);
});

test("isFixReportable accepts a fresh in-range fix", () => {
  const now = 1_000_000;
  assert.equal(isFixReportable({ lat: 41.9, lng: -70.6, ts: now - 1000 }, now), true);
});

test("isFixReportable rejects a stale fix (keep-latest / drop-old)", () => {
  const now = 1_000_000;
  const stale = { lat: 41.9, lng: -70.6, ts: now - MAX_REPORT_FIX_AGE_MS - 1 };
  assert.equal(isFixReportable(stale, now), false);
});

test("isFixReportable rejects bad coordinates and missing ts", () => {
  const now = 1_000_000;
  assert.equal(isFixReportable(null, now), false);
  assert.equal(isFixReportable({ lat: 999, lng: 0, ts: now }, now), false);
  assert.equal(isFixReportable({ lat: 0, lng: 0, ts: 0 }, now), false);
});
