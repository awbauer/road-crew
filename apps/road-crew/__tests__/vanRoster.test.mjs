// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchVanRoster, VanRosterError } from "../src/api/vanRoster.js";

function response(ok, payload, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

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

test("fetchVanRoster falls back to the static copy when the API fails", async () => {
  const staticOnly = await fetchVanRoster(async (path) => (
    path === "/data/vans.json"
      ? response(true, { vans: [{ number: "VAN-9", label: "VAN-9" }] })
      : response(false, {})
  ), ["/api/vans", "/data/vans.json"]);
  assert.deepEqual(staticOnly, [{ number: "VAN-9", label: "VAN-9" }]);
});

test("fetchVanRoster never invents a roster: every source failing is an error", async () => {
  await assert.rejects(
    fetchVanRoster(async () => {
      throw new Error("offline");
    }, ["/api/vans", "/data/vans.json"]),
    (error) => error instanceof VanRosterError && /reach the server/.test(error.message),
  );
  await assert.rejects(
    fetchVanRoster(async () => response(true, { vans: [] }), ["/api/vans"]),
    VanRosterError,
  );
});

test("a refused roster request is reported as a refusal, not replaced", async () => {
  const calls = [];
  await assert.rejects(
    fetchVanRoster(async (path) => {
      calls.push(path);
      return response(false, { error: "Forbidden" }, 403);
    }, ["/api/vans", "/data/vans.json"]),
    (error) => error instanceof VanRosterError && error.status === 403 && /not authorized/.test(error.message),
  );
  assert.deepEqual(calls, ["/api/vans"]);
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
