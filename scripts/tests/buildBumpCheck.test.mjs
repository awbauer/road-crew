import assert from "node:assert/strict";
import test from "node:test";

import {
  checkBuildBump,
  isExemptPath,
  parseBuild,
  requiresBuildBump,
  suggestedBuild,
} from "../buildBumpCheck.mjs";

test("shipped code requires a build bump; docs, tests and tooling do not", () => {
  for (const file of [
    "apps/road-crew/src/field/RouteMap.native.tsx",
    "packages/core/src/appStatus.ts",
    "packages/data/routes/sequences.json",
  ]) {
    assert.equal(requiresBuildBump(file), true, file);
  }

  for (const file of [
    "docs/plan.md",
    "packages/config/VERSION_HISTORY.md",
    ".github/workflows/ci.yml",
    ".claude/settings.json",
    "scripts/check-build-bump.mjs",
    "apps/road-crew/__tests__/fleet.test.mjs",
    "apps/road-crew/e2e/app.spec.js",
    "packages/core/tests/core.test.ts",
  ]) {
    assert.equal(requiresBuildBump(file), false, file);
    assert.equal(isExemptPath(file), true, file);
  }

  // Outside the shipped trees entirely.
  assert.equal(requiresBuildBump("Makefile"), false);
  assert.equal(requiresBuildBump("playwright.config.js"), false);
});

test("a docs-only branch passes without touching the build", () => {
  const result = checkBuildBump({
    changedFiles: ["docs/plan.md", "apps/road-crew/README.md"],
    baseBuild: "17849429",
    headBuild: "17849429",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.shipping, []);
});

test("shipped changes without a bump fail, and say why", () => {
  const result = checkBuildBump({
    changedFiles: ["apps/road-crew/src/field/StatusSheet.tsx", "docs/plan.md"],
    baseBuild: "17849429",
    headBuild: "17849429",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /still 17849429/);
  // Only the shipped file is reported, not the doc alongside it.
  assert.deepEqual(result.shipping, ["apps/road-crew/src/field/StatusSheet.tsx"]);
});

test("an advanced build passes; a stale or missing one does not", () => {
  const changedFiles = ["packages/core/src/appStatus.ts"];
  assert.equal(checkBuildBump({ changedFiles, baseBuild: "17849429", headBuild: "17849500" }).ok, true);

  const older = checkBuildBump({ changedFiles, baseBuild: "17849429", headBuild: "17849000" });
  assert.equal(older.ok, false);
  assert.match(older.reason, /older than/);

  const missing = checkBuildBump({ changedFiles, baseBuild: "17849429", headBuild: null });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /Could not read/);
});

test("parseBuild reads CURRENT_BUILD out of version.ts", () => {
  assert.equal(parseBuild('const CURRENT_BUILD = "17849429";'), "17849429");
  assert.equal(parseBuild("const CURRENT_RELEASE = \"2.1.7\";"), null);
  assert.equal(parseBuild(null), null);
});

test("suggestedBuild is the first 8 digits of the UTC unix timestamp", () => {
  assert.equal(suggestedBuild(1_784_942_900_000), "17849429");
  assert.equal(suggestedBuild().length, 8);
});
