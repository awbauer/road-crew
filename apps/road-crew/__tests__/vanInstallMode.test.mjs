import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldInitializeVanInstall, shouldShowVanInstall } from "../src/auth/vanInstallMode.js";

test("build flag shows the van-install picker until a van is selected", () => {
  assert.equal(
    shouldShowVanInstall({ buildVanInstall: true, vanId: null, vanInstall: false }),
    true,
  );
  assert.equal(
    shouldShowVanInstall({ buildVanInstall: true, vanId: "VAN-7", vanInstall: false }),
    false,
  );
});

test("persisted install state cannot expose the picker without the build flag", () => {
  assert.equal(
    shouldShowVanInstall({ buildVanInstall: false, vanId: null, vanInstall: true }),
    false,
  );
  assert.equal(
    shouldShowVanInstall({ buildVanInstall: false, vanId: null, vanInstall: false }),
    false,
  );
});

test("skip marker suppresses prompts until reset clears it", () => {
  assert.equal(
    shouldShowVanInstall({
      buildVanInstall: true,
      vanId: null,
      vanInstall: true,
      vanInstallSkipped: true,
    }),
    false,
  );
  assert.equal(
    shouldShowVanInstall({
      buildVanInstall: true,
      vanId: null,
      vanInstall: true,
      vanInstallSkipped: false,
    }),
    true,
  );
});

test("an explicit standard choice overrides the build default", () => {
  assert.equal(shouldInitializeVanInstall({ buildVanInstall: true, vanInstallConfigured: true }), false);
  assert.equal(shouldInitializeVanInstall({ buildVanInstall: true, vanInstallConfigured: false }), true);
  assert.equal(shouldShowVanInstall({
    buildVanInstall: true,
    vanInstall: false,
    vanInstallConfigured: true,
    vanId: null,
  }), false);
});
