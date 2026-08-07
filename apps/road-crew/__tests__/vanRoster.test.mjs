import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_VAN_IDS, defaultVanRoster, fetchVanRoster } from "../src/api/vanRoster.js";

function response(ok, payload) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test("defaultVanRoster exposes VAN-1 through VAN-30", () => {
  const vans = defaultVanRoster();
  assert.equal(vans.length, DEFAULT_VAN_IDS.length);
  assert.deepEqual(vans[0], { number: "VAN-1", label: "VAN-1" });
  assert.deepEqual(vans.at(-1), { number: "VAN-30", label: "VAN-30" });
});

test("fetchVanRoster prefers the API response when available", async () => {
  const calls = [];
  const vans = await fetchVanRoster(async (path) => {
    calls.push(path);
    return path === "/api/vans"
      ? response(true, { vans: [{ number: "VAN-7", label: "VAN-7" }] })
      : response(false, {});
  }, ["/api/vans", "/data/vans.json"]);

  assert.deepEqual(vans, [{ number: "VAN-7", label: "VAN-7" }]);
  assert.deepEqual(calls, ["/api/vans"]);
});

test("fetchVanRoster falls back to static data, then to the default roster", async () => {
  const staticOnly = await fetchVanRoster(async (path) => (
    path === "/data/vans.json"
      ? response(true, { vans: [{ number: "VAN-9", label: "VAN-9" }] })
      : response(false, {})
  ), ["/api/vans", "/data/vans.json"]);
  assert.deepEqual(staticOnly, [{ number: "VAN-9", label: "VAN-9" }]);

  const defaulted = await fetchVanRoster(async () => {
    throw new Error("offline");
  }, ["/api/vans", "/data/vans.json"]);
  assert.deepEqual(defaulted.slice(0, 2), [
    { number: "VAN-1", label: "VAN-1" },
    { number: "VAN-2", label: "VAN-2" },
  ]);
});

test("fetchVanRoster honors the Worker hide flag without using static fallback data", async () => {
  const calls = [];
  const vans = await fetchVanRoster(async (path) => {
    calls.push(path);
    return response(true, { vans: [], hidden: true });
  }, ["/api/vans", "/data/vans.json"]);

  assert.deepEqual(vans, []);
  assert.deepEqual(calls, ["/api/vans"]);
});
