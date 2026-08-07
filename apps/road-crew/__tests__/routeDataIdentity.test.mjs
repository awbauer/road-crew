import assert from "node:assert/strict";
import test from "node:test";

import { routeDataRevision } from "../src/field/routeDataIdentity.ts";

test("the generated timestamp identifies an unchanged route catalog", () => {
  const first = { generated_at: "2026-08-01T12:00:00Z", routes: [{ id: "one", sequences: [] }] };
  const second = { generated_at: first.generated_at, routes: [{ id: "one", sequences: [] }] };
  assert.equal(routeDataRevision(first), routeDataRevision(second));
});

test("catalogs without metadata fall back to their payload", () => {
  const first = { routes: [{ id: "one", sequences: [] }] };
  const second = { routes: [{ id: "two", sequences: [] }] };
  assert.notEqual(routeDataRevision(first), routeDataRevision(second));
});
