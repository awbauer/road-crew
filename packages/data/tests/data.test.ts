import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  loadSequences,
  loadVans,
  getRouteById,
  generatedAtMs,
  getDataWarnings,
  resetDataCache,
} from "../src/index.ts";

beforeEach(() => resetDataCache());

/** Minimal Response-like stub. */
function res(ok: boolean, json: unknown): Response {
  return { ok, status: ok ? 200 : 404, json: async () => json } as unknown as Response;
}

/** Builds a fetch stub from a URL→response map, recording calls. */
function stubFetch(routes: Record<string, Response | undefined>) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    const r = routes[String(url)];
    if (!r) throw new Error(`unexpected url ${url}`);
    return r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("loadSequences: splices detour 900s inline after their anchor", async () => {
  const sequences = [
    { seq: 204 },
    { seq: 205 },
    { seq: 206 },
    { seq: 901 },
    { seq: 902 },
    { seq: 903 },
    { seq: 904 },
  ];
  const { fn } = stubFetch({
    "/data/sequences.json": res(true, { routes: [{ id: "day1_route1", sequences }] }),
    "/data/paths/day1_route1.json": res(true, [[-71, 42], [-71, 42.01]]),
  });
  const data = await loadSequences({ fetchImpl: fn });
  const order = data.routes[0].sequences.map((s) => s.seq);
  assert.deepEqual(order, [204, 205, 901, 902, 903, 904, 206]);
  // path attached for a known path route id
  assert.deepEqual(data.routes[0].path, [[-71, 42], [-71, 42.01]]);
});

test("loadSequences: absolute base URL is prefixed; missing path is non-fatal", async () => {
  const { fn, calls } = stubFetch({
    "https://x.dev/data/sequences.json": res(true, { routes: [{ id: "day2_route3", sequences: [{ seq: 1 }] }] }),
    "https://x.dev/data/paths/day2_route3.json": res(false, {}),
  });
  const data = await loadSequences({ baseUrl: "https://x.dev", fetchImpl: fn });
  assert.equal(data.routes[0].path, undefined);
  assert.ok(calls.includes("https://x.dev/data/sequences.json"));
});

test("loadSequences: reconnect refresh bypasses memory without discarding the last good payload", async () => {
  let version = 1;
  let fail = false;
  const fn = (async (url: string) => {
    if (fail) throw new Error("offline");
    if (String(url) === "/data/sequences.json") {
      return res(true, { routes: [{ id: `route-${version}`, sequences: [{ seq: version }] }] });
    }
    return res(false, {});
  }) as unknown as typeof fetch;

  const first = await loadSequences({ fetchImpl: fn });
  assert.equal(first.routes[0].id, "route-1");

  version = 2;
  const refreshed = await loadSequences({ fetchImpl: fn, forceRefresh: true });
  assert.equal(refreshed.routes[0].id, "route-2");

  fail = true;
  await assert.rejects(() => loadSequences({ fetchImpl: fn, forceRefresh: true }), /offline/);
  assert.equal((await loadSequences({ fetchImpl: fn })).routes[0].id, "route-2");
});

test("loadSequences: throws on malformed payload", async () => {
  const { fn } = stubFetch({ "/data/sequences.json": res(true, { nope: true }) });
  await assert.rejects(() => loadSequences({ fetchImpl: fn }), /malformed/);
});

test("loadVans: prefers /api/vans, falls back to static file, then empty", async () => {
  const api = stubFetch({
    "/api/vans": res(true, { vans: [{ number: "1", label: "Van 1" }] }),
    "/data/vans.json": res(true, { vans: [] }),
  });
  assert.deepEqual((await loadVans({ fetchImpl: api.fn })).vans, [{ number: "1", label: "Van 1" }]);

  resetDataCache();
  const staticOnly = stubFetch({
    "/api/vans": res(false, {}),
    "/data/vans.json": res(true, { vans: [{ number: "2", label: "Van 2" }] }),
  });
  assert.deepEqual((await loadVans({ fetchImpl: staticOnly.fn })).vans, [{ number: "2", label: "Van 2" }]);

  resetDataCache();
  const none = stubFetch({ "/api/vans": res(false, {}), "/data/vans.json": res(false, {}) });
  assert.deepEqual((await loadVans({ fetchImpl: none.fn })).vans, []);
});

test("helpers: getRouteById + generatedAtMs + warnings", async () => {
  const { fn } = stubFetch({
    "/data/sequences.json": res(true, {
      generated_at: "2026-01-02T03:04:05Z",
      routes: [{ id: "day1_route1", sequences: [{ seq: 901 }] }],
    }),
    "/data/paths/day1_route1.json": res(false, {}),
  });
  const data = await loadSequences({ fetchImpl: fn });
  assert.equal(getRouteById(data, "day1_route1")!.id, "day1_route1");
  assert.equal(getRouteById(data, "nope"), null);
  assert.equal(generatedAtMs(data), Date.parse("2026-01-02T03:04:05Z"));
  assert.equal(generatedAtMs(null), 0);
  // A detour seq present with no anchor should record a warning.
  assert.ok(getDataWarnings().some((w) => w.includes("detour anchor seq 205 missing")));
});
