import { test } from "node:test";
import assert from "node:assert/strict";

import {
  haversine,
  bearingTo,
  angularDelta,
  nearestSequence,
  nearestSequences,
  formatDistance,
  fmtMiles,
  distanceToNextSequenceMiles,
  formatSpeed,
  formatHeading,
  nearestPointOnPath,
  pathBearingAt,
  sequenceAddress,
  sequenceDestination,
  navigationHref,
  appleMapsHref,
  directionLabel,
  sequenceFlags,
  hasCoordinates,
  navigationScheme,
  appleMapsScheme,
  nextSignificantSequence,
  parseQuery,
  matchSequence,
  findCrossRouteMatches,
  validateRouteData,
  formatRelative,
  jitter,
  redactSensitiveFields,
  sanitizeFix,
  computeAppStatus,
  sanitizeNotification,
  matchesTarget,
  selectVisible,
  selectForCenter,
  upsertArchive,
  pruneArchive,
  reconcileArchive,
  sortForCenter,
  unreadCount,
  nearestCumberlandFarm,
  clusterCumberlandFarms,
  cumberlandFarmClusterDistanceForZoom,
  cumberlandFarmNavigationHref,
  cumberlandFarmNavigationScheme,
  displayCumberlandFarmStoreNumber,
} from "../src/index.ts";
import type { Route, Sequence } from "@road-crew/contracts";

const seq = (over: Partial<Sequence> & { seq: number }): Sequence => ({ ...over });

test("haversine: zero distance and a known ~1km leg", () => {
  assert.equal(haversine(42, -71, 42, -71), 0);
  const d = haversine(42.0, -71.0, 42.0089, -71.0);
  assert.ok(Math.abs(d - 990) < 40, `expected ~990m, got ${d}`);
});

test("nearest Cumberland Farms: picks the closest store and builds map links", () => {
  const farms = [
    { id: "near", name: "Cumberland Farms", storeNumber: "1", address: "1 Main", city: "Bourne", state: "MA", zip: "02532", phone: "", lat: 42.001, lng: -71, source: "" },
    { id: "far", name: "Cumberland Farms", storeNumber: "2", address: "2 Main", city: "Bourne", state: "MA", zip: "02532", phone: "", lat: 42.02, lng: -71, source: "" },
  ];
  const result = nearestCumberlandFarm(farms, 42, -71);
  assert.ok(result);
  assert.equal(result!.farm.id, "near");
  assert.ok(result!.distance > 0);
  assert.ok(cumberlandFarmNavigationHref(farms[0], "google").includes("42.001,-71"));
  assert.ok(cumberlandFarmNavigationScheme(farms[0], "waze").startsWith("waze://"));
  assert.equal(nearestCumberlandFarm(farms, NaN, -71), null);
});

test("Cumberland Farms cluster nearby stores while keeping separated stores distinct", () => {
  const farms = [
    { id: "a", name: "Cumberland Farms", storeNumber: "1", address: "1 Main", city: "Bourne", state: "MA", zip: "02532", phone: "", lat: 42, lng: -71, source: "" },
    { id: "b", name: "Cumberland Farms", storeNumber: "2", address: "2 Main", city: "Bourne", state: "MA", zip: "02532", phone: "", lat: 42.001, lng: -71, source: "" },
    { id: "c", name: "Cumberland Farms", storeNumber: "3", address: "3 Main", city: "Bourne", state: "MA", zip: "02532", phone: "", lat: 42.05, lng: -71, source: "" },
  ];
  const clusters = clusterCumberlandFarms(farms, 200);
  assert.deepEqual(clusters.map((cluster) => cluster.farms.map((farm) => farm.id)), [["a", "b"], ["c"]]);
});

test("Cumberland Farms cluster radius shrinks as the map zooms in", () => {
  assert.ok(cumberlandFarmClusterDistanceForZoom(8) > cumberlandFarmClusterDistanceForZoom(14));
  assert.equal(cumberlandFarmClusterDistanceForZoom(Number.NaN), 1_500);
});

test("Cumberland Farms store numbers display without leading zeros", () => {
  assert.equal(displayCumberlandFarmStoreNumber("000302"), "302");
  assert.equal(displayCumberlandFarmStoreNumber("0"), "0");
  assert.equal(displayCumberlandFarmStoreNumber(" 42 "), "42");
});

test("bearingTo + angularDelta", () => {
  assert.ok(Math.abs(bearingTo(0, 0, 1, 0) - 0) < 0.5); // due north
  assert.ok(Math.abs(bearingTo(0, 0, 0, 1) - 90) < 0.5); // due east
  assert.equal(angularDelta(10, 350), 20);
  assert.equal(angularDelta(0, 180), 180);
});

test("nearestSequence: skips non-finite coords, picks closest", () => {
  const seqs = [
    seq({ seq: 1, lat: NaN, lng: NaN }),
    seq({ seq: 2, lat: 42.01, lng: -71.0 }),
    seq({ seq: 3, lat: 42.0001, lng: -71.0 }),
  ];
  const r = nearestSequence(seqs, 42.0, -71.0);
  assert.ok(r);
  assert.equal(r!.seq.seq, 3);
  assert.equal(nearestSequence([], 42, -71), null);
  assert.equal(nearestSequence(seqs, NaN, -71), null);
});

test("nearestSequences: returns the bracketing pair with direction", () => {
  // A sequence's `street` is the road you travel AFTER that GPS point, so the
  // segment between seq 1 and seq 2 is "First St" (seq 1's street). The fix at
  // 42.005 sits on that segment.
  const seqs = [
    seq({ seq: 1, lat: 42.0, lng: -71.0, street: "First St" }),
    seq({ seq: 2, lat: 42.01, lng: -71.0, street: "Second St" }),
    seq({ seq: 3, lat: 42.02, lng: -71.0, street: "Third St" }),
  ];
  const r = nearestSequences(seqs, 42.005, -71.0, { traversalDir: "forward" });
  assert.ok(r);
  assert.equal(r!.previous.seq.seq, 1);
  assert.equal(r!.next.seq.seq, 2);
  assert.equal(r!.routeStart.seq.seq, 1);
  assert.equal(r!.routeEnd.seq.seq, 2);
  // The road you're on = the segment's lower index (routeStart) street.
  assert.equal(r!.routeStart.seq.street, "First St");
  assert.equal(nearestSequences([seq({ seq: 1, lat: 42, lng: -71 })], 42, -71), null);
});

test("nearestSequences: reverse swaps previous/next but routeStart names the same road", () => {
  // Same segment, patrolled backward. previous/next flip (so Follow tracks the
  // sequence you're heading toward), but routeStart/routeEnd keep segment order.
  // The road you're physically on is unchanged by direction — it's still the
  // segment's lower-index street ("First St") — which is why the street sign
  // reads routeStart, NOT `previous` (whose street would wrongly be "Second St").
  const seqs = [
    seq({ seq: 1, lat: 42.0, lng: -71.0, street: "First St" }),
    seq({ seq: 2, lat: 42.01, lng: -71.0, street: "Second St" }),
    seq({ seq: 3, lat: 42.02, lng: -71.0, street: "Third St" }),
  ];
  const r = nearestSequences(seqs, 42.005, -71.0, { traversalDir: "reverse" });
  assert.ok(r);
  assert.equal(r!.direction, "reverse");
  assert.equal(r!.previous.seq.seq, 2); // heading back toward seq 1
  assert.equal(r!.next.seq.seq, 1);
  assert.equal(r!.routeStart.seq.seq, 1); // segment order unchanged
  assert.equal(r!.routeEnd.seq.seq, 2);
  assert.equal(r!.routeStart.seq.street, "First St"); // the road you're on
  assert.equal(r!.previous.seq.street, "Second St"); // the wrong road (documents the bug)
});

test("formatDistance / formatSpeed / formatHeading", () => {
  assert.equal(formatDistance(null), "—");
  assert.equal(formatDistance(100), "328 ft");
  assert.equal(formatDistance(1609.34), "1.0 mi");
  assert.equal(formatSpeed(-1), "—");
  assert.equal(formatSpeed(0), "0 mph");
  assert.equal(formatSpeed(2), "4 mph");
  assert.equal(formatHeading(90), "E");
  assert.equal(formatHeading(null), "—");
});

test("fmtMiles / distanceToNextSequenceMiles", () => {
  assert.equal(fmtMiles(1.234), "1.2 mi");
  assert.equal(fmtMiles(1.234, 2), "1.23 mi");
  assert.equal(fmtMiles("x" as unknown as number), null);
  const seqs = [seq({ seq: 1, miles: 0.5 }), seq({ seq: 2, cum_miles: 1 })];
  assert.equal(distanceToNextSequenceMiles(seqs, 0), 0.5);
  const seqs2 = [seq({ seq: 1, cum_miles: 1 }), seq({ seq: 2, cum_miles: 2.5 })];
  assert.equal(distanceToNextSequenceMiles(seqs2, 0), 1.5);
  assert.equal(distanceToNextSequenceMiles(seqs, 5), null);
});

test("pathDistance helpers", () => {
  const path: [number, number][] = [[-71.0, 42.0], [-71.0, 42.02]];
  const np = nearestPointOnPath(path, 42.01, -70.999);
  assert.ok(np);
  assert.equal(np!.segmentIndex, 0);
  assert.ok(np!.distance < 120);
  assert.equal(nearestPointOnPath([[-71, 42]], 42, -71), null);
  assert.ok(Math.abs((pathBearingAt(path, 0) as number) - 0) < 0.5);
});

test("sequence formatting + nav hrefs", () => {
  const s = seq({ seq: 5, num_first: "12", street: "Main St", town: "Bourne", dir: "L", water_stop: true, lat: 41.74, lng: -70.6 });
  // The address is still built — the detail view displays it — it is just no
  // longer what navigation is aimed at.
  assert.equal(sequenceAddress(s), "12 Main St Bourne MA");
  assert.equal(directionLabel("L"), "Left");
  assert.equal(directionLabel(null), "—");
  assert.deepEqual(sequenceFlags(s), ["Water stop"]);
  // Every nav link targets the sequence's GPS point, never its address.
  assert.equal(sequenceDestination(s), "41.74,-70.6");
  assert.equal(appleMapsHref(s), "https://maps.apple.com/?daddr=41.74,-70.6&dirflg=d");
  assert.equal(navigationHref(s, "google"), "https://www.google.com/maps/dir/?api=1&destination=41.74,-70.6");
  assert.equal(navigationHref(s, "waze"), "https://waze.com/ul?ll=41.74,-70.6&navigate=yes");
  // App-scheme variants launch the native app directly.
  assert.equal(appleMapsScheme(s), "maps://?daddr=41.74,-70.6&dirflg=d");
  assert.equal(navigationScheme(s, "google"), "comgooglemaps://?daddr=41.74,-70.6&directionsmode=driving");
  assert.equal(navigationScheme(s, "waze"), "waze://?ll=41.74,-70.6&navigate=yes");
  assert.equal(navigationScheme(s), "maps://?daddr=41.74,-70.6&dirflg=d");
  // No coordinate means no destination, so links are dead rather than pointing
  // somewhere plausible but wrong. The old address form could not express this:
  // sequenceAddress appends "MA" unconditionally, so a sequence with no street
  // or town still navigated the driver to the middle of the state.
  const noCoords = seq({ seq: 1, num_first: "12", street: "Main St", town: "Bourne" });
  assert.equal(sequenceDestination(noCoords), "");
  assert.equal(navigationHref(noCoords), "#");
  assert.equal(navigationScheme(noCoords), "#");
  assert.equal(navigationHref(noCoords, "waze"), "#");
  assert.equal(hasCoordinates(seq({ seq: 1, lat: 42, lng: -71 })), true);
  assert.equal(hasCoordinates(seq({ seq: 1 })), false);
});

test("nextSignificantSequence: skips straights without flags", () => {
  const route: Route = {
    id: "r1",
    sequences: [
      seq({ seq: 1, dir: "S" }),
      seq({ seq: 2, dir: "S" }),
      seq({ seq: 3, dir: "R" }),
    ],
  };
  const r = nextSignificantSequence(route, 0);
  assert.equal(r!.seq.seq, 3);
  assert.equal(nextSignificantSequence(route, null), null);
});

test("search: parseQuery / matchSequence / cross-route", () => {
  assert.deepEqual(parseQuery(""), { kind: "empty" });
  assert.deepEqual(parseQuery("#47"), { kind: "seq", value: 47 });
  assert.deepEqual(parseQuery("Main"), { kind: "text", value: "main" });
  const s = seq({ seq: 47, street: "Main St", town: "Bourne" });
  assert.equal(matchSequence(s, parseQuery("#47")), true);
  assert.equal(matchSequence(s, parseQuery("bourne")), true);
  assert.equal(matchSequence(s, parseQuery("nowhere")), false);
  const routes: Route[] = [
    { id: "r1", sequences: [seq({ seq: 1, street: "Elm" })] },
    { id: "r2", sequences: [seq({ seq: 2, street: "Main St" })] },
  ];
  const matches = findCrossRouteMatches(routes, "r1", parseQuery("main"));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].route.id, "r2");
});

test("validateRouteData: flags structural problems", () => {
  assert.deepEqual(validateRouteData(null), ["Route data payload is missing or invalid."]);
  assert.deepEqual(validateRouteData({ routes: [] }), ["Route data contains no routes."]);
  const issues = validateRouteData({
    routes: [
      { id: "r1", sequences: [seq({ seq: 1, lat: 999 })] },
      { id: "r1", sequences: [seq({ seq: 1 })] },
    ],
  });
  assert.ok(issues.some((i) => i.includes("duplicate route id")));
  assert.ok(issues.some((i) => i.includes("invalid latitude")));
  assert.ok(issues.some((i) => i.includes("incomplete coordinates")));
});

test("redactSensitiveFields: strips lat/lng anywhere in the tree", () => {
  const input = { lat: 42.1, lng: -71.3, fix: { latitude: 42, coords: [1, 2] }, ok: "keep", n: 5 };
  const out = redactSensitiveFields(input) as Record<string, any>;
  assert.equal(out.lat, "[redacted]");
  assert.equal(out.lng, "[redacted]");
  assert.equal(out.fix.latitude, "[redacted]");
  assert.equal(out.fix.coords, "[redacted]");
  assert.equal(out.ok, "keep");
  assert.equal(out.n, 5);
  // primitives + cycles don't throw
  assert.equal(redactSensitiveFields("x"), "x");
  const cyc: any = { a: 1 };
  cyc.self = cyc;
  assert.doesNotThrow(() => redactSensitiveFields(cyc));
});

test("formatRelative", () => {
  const now = 1_800_000;
  assert.equal(formatRelative(null), "never");
  assert.equal(formatRelative(now, now), "just now");
  assert.equal(formatRelative(now - 120000, now), "2m ago");
});

test("sanitizeFix: rejects out-of-range/non-finite coords, coerces optional fields", () => {
  assert.equal(sanitizeFix(null), null);
  assert.equal(sanitizeFix({ lat: 200, lng: 0 }), null);
  assert.equal(sanitizeFix({ lat: 0, lng: -200 }), null);
  assert.equal(sanitizeFix({ lat: "not a number", lng: 0 }), null);

  const fix = sanitizeFix({ lat: 42.5, lng: -71.2, accuracy: null, speed: undefined, heading: 90, ts: 1000 });
  assert.deepEqual(fix, { lat: 42.5, lng: -71.2, accuracy: null, speed: null, heading: 90, ts: 1000 });

  // Missing/invalid ts falls back to "now" (within a generous tolerance).
  const now = sanitizeFix({ lat: 1, lng: 1 })!;
  assert.ok(Math.abs(now.ts - Date.now()) < 5000);
});

test("computeAppStatus: worst-issue-wins, matches legacy thresholds", () => {
  const now = 1_000_000_000;
  const base = { hasFix: true, fixTs: now, online: true, dataGeneratedAtMs: now, validationIssueCount: 0, nowMs: now };

  assert.deepEqual(computeAppStatus({ ...base, hasFix: false, fixTs: null }), { level: "red", label: "No GPS" });
  assert.deepEqual(computeAppStatus({ ...base, fixTs: now - 121_000 }), { level: "red", label: "GPS lost" });
  assert.deepEqual(computeAppStatus({ ...base, online: false, fixTs: now - 31_000 }), { level: "amber", label: "Offline · GPS stale" });
  assert.deepEqual(computeAppStatus({ ...base, online: false }), { level: "amber", label: "Offline" });
  assert.deepEqual(computeAppStatus({ ...base, fixTs: now - 31_000 }), { level: "amber", label: "GPS stale" });
  assert.deepEqual(computeAppStatus({ ...base, locationReportFailed: true }), { level: "amber", label: "Location issue" });
  assert.deepEqual(computeAppStatus({ ...base, dataGeneratedAtMs: now - 31 * 86_400_000 }), { level: "amber", label: "Data >30d old" });
  assert.deepEqual(computeAppStatus({ ...base, validationIssueCount: 2 }), { level: "amber", label: "Data issue" });
  assert.deepEqual(computeAppStatus(base), { level: "green", label: "Live" });
});

test("computeAppStatus: trackingPaused reports Untracked, but never over a real issue", () => {
  const now = 1_000_000_000;
  const base = { hasFix: true, fixTs: now, online: true, dataGeneratedAtMs: now, validationIssueCount: 0, nowMs: now };

  // Replaces "Live" when nothing else is wrong.
  assert.deepEqual(computeAppStatus({ ...base, trackingPaused: true }), { level: "untracked", label: "Untracked" });

  // Every more urgent status still wins.
  assert.deepEqual(
    computeAppStatus({ ...base, trackingPaused: true, hasFix: false, fixTs: null }),
    { level: "red", label: "No GPS" },
  );
  assert.deepEqual(
    computeAppStatus({ ...base, trackingPaused: true, online: false }),
    { level: "amber", label: "Offline" },
  );
  assert.deepEqual(
    computeAppStatus({ ...base, trackingPaused: true, fixTs: now - 31_000 }),
    { level: "amber", label: "GPS stale" },
  );
  assert.deepEqual(
    computeAppStatus({ ...base, trackingPaused: true, validationIssueCount: 2 }),
    { level: "amber", label: "Data issue" },
  );
});

test("sanitizeNotification: normalizes and defaults unknown enums rather than dropping", () => {
  assert.equal(sanitizeNotification(null), null);
  assert.equal(sanitizeNotification({}), null); // no id → unusable

  const n = sanitizeNotification({
    id: 42,
    type: "bogus-type",
    severity: "high",
    target: { scope: "route", value: "day1_route1" },
    title: "Detour",
    body: "Cones on Main St",
    pinned: true,
    action: { kind: "go-to-sequence", routeId: "day1_route1", seq: "7" },
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
  })!;
  assert.equal(n.id, "42"); // coerced to string
  assert.equal(n.type, "message"); // unknown type defaults rather than drops
  assert.equal(n.severity, "high");
  assert.deepEqual(n.target, { scope: "route", value: "day1_route1" });
  assert.equal(n.pinned, true);
  assert.deepEqual(n.action, { kind: "go-to-sequence", routeId: "day1_route1", seq: 7 });
  assert.equal(n.expiresMs, null);
  assert.ok(n.createdMs > 0);
});

test("matchesTarget: global always matches; van/route require an exact value match", () => {
  const global = { target: { scope: "global" as const, value: null } };
  const van = { target: { scope: "van" as const, value: "12" } };
  const route = { target: { scope: "route" as const, value: "day1_route1" } };

  assert.equal(matchesTarget(global, {}), true);
  assert.equal(matchesTarget(van, {}), false); // no vanNumber set
  assert.equal(matchesTarget(van, { vanNumber: "12" }), true);
  assert.equal(matchesTarget(van, { vanNumber: "13" }), false);
  assert.equal(matchesTarget(route, {}), false); // no routeId set
  assert.equal(matchesTarget(route, { routeId: "day1_route1" }), true);
  assert.equal(matchesTarget(route, { routeId: "day2_route1" }), false);
});

test("selectVisible: filters to targeted, unexpired, unseen; newest first", () => {
  const now = 1_000_000_000;
  const list = [
    { id: "a", target: { scope: "global" }, createdAt: new Date(now - 1000).toISOString() },
    { id: "b", target: { scope: "global" }, createdAt: new Date(now).toISOString() },
    { id: "c", target: { scope: "route", value: "other" }, createdAt: new Date(now).toISOString() },
    { id: "d", target: { scope: "global" }, createdAt: new Date(now).toISOString(), expiresAt: new Date(now - 500).toISOString() },
  ];
  const visible = selectVisible(list, { routeId: "day1_route1", seenIds: { a: now }, nowMs: now });
  assert.deepEqual(visible.map((n) => n.id), ["b"]); // a=seen, c=wrong route, d=expired
});

test("selectForCenter / upsertArchive / pruneArchive / reconcileArchive / sortForCenter / unreadCount", () => {
  const now = 1_000_000_000;
  const raw = [
    { id: "pinned", target: { scope: "global" }, pinned: true, createdAt: new Date(now - 3000).toISOString() },
    { id: "recent", target: { scope: "global" }, createdAt: new Date(now).toISOString() },
    { id: "old", target: { scope: "global" }, createdAt: new Date(now - 5000).toISOString() },
  ];
  const targeted = selectForCenter(raw, {});
  assert.equal(targeted.length, 3);

  let archive = upsertArchive({}, targeted, now);
  assert.equal(archive.recent.read, false);
  assert.equal(archive.recent.firstSeenAt, now);

  // Re-upserting preserves read state + original firstSeenAt.
  archive.recent = { ...archive.recent, read: true };
  archive = upsertArchive(archive, targeted, now + 10_000);
  assert.equal(archive.recent.read, true);
  assert.equal(archive.recent.firstSeenAt, now);

  // reconcileArchive drops items gone from the feed that haven't expired.
  const withoutOld = raw.filter((n) => n.id !== "old");
  const reconciled = reconcileArchive(archive, withoutOld, now);
  assert.ok(!("old" in reconciled));
  assert.ok("recent" in reconciled);

  // Local application notices are intentionally independent of Command's
  // feed, so a successful heartbeat must not remove update history.
  const local = {
    ...targeted[0],
    id: "local-update:applied:123",
    source: "local" as const,
  };
  const withLocal = upsertArchive(archive, [local], now);
  assert.ok("local-update:applied:123" in reconcileArchive(withLocal, withoutOld, now));

  const sorted = sortForCenter(Object.values(archive), now);
  assert.equal(sorted[0].id, "pinned"); // pinned-active always ranks first
  assert.equal(unreadCount(Object.values(archive), now), 2); // recent(read)=excluded, pinned+old=unread

  // pruneArchive: entries past the TTL are dropped outright; within the TTL, a
  // tight cap keeps pinned items preferentially over newer non-pinned ones.
  assert.equal(Object.keys(pruneArchive(archive, now + 10_000_000, { ttlMs: 5_000_000, cap: 200 })).length, 0);
  const capped = pruneArchive(archive, now, { ttlMs: 5_000_000, cap: 1 });
  assert.deepEqual(Object.keys(capped), ["pinned"]);
});

test("jitter: stays within the ratio band and varies between calls", () => {
  const base = 30_000;
  const samples = Array.from({ length: 200 }, () => jitter(base));
  for (const value of samples) {
    assert.ok(value >= base * 0.8 && value <= base * 1.2, `${value} outside +/-20% of ${base}`);
  }
  // Spread, not a constant: a fleet in lockstep is the whole problem.
  assert.ok(new Set(samples).size > 50);

  // A zero ratio opts out, and non-positive intervals are inert.
  assert.equal(jitter(base, 0), base);
  assert.equal(jitter(0), 0);
  assert.equal(jitter(Number.NaN), 0);
});
