import { test } from "node:test";
import assert from "node:assert/strict";

import { colors, fontFamily, theme } from "../src/index.ts";

const canonicalColors = {
  bg: "#0b0b0d",
  bgElevated: "#141416",
  bgPanel: "#1b1b1f",
  bgControl: "#25252a",
  border: "#37373d",
  borderStrong: "#4b4b52",
  text: "#f5f5f6",
  textMuted: "#b9b9c0",
  textSubtle: "#8f8f98",
  brandRed: "#d92f45",
  brandRedDark: "#9f2634",
  brandRedSoft: "rgba(217, 47, 69, 0.22)",
  green: "#30a962",
  blue: "#4a90e2",
  amber: "#c78324",
  routeOnBg: "#14532d",
  routeOnText: "#d8f5e3",
  routeOffBg: "#2a2a30",
} as const;

test("shared colors retain the approved field-app palette", () => {
  assert.deepEqual(colors, canonicalColors);
});

test("shared font stack retains the approved system-font order", () => {
  assert.equal(
    fontFamily,
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
  );
});

test("semantic theme resolves to canonical tokens", () => {
  assert.equal(theme.colors.background, colors.bg);
  assert.equal(theme.colors.accent, colors.brandRed);
  assert.equal(theme.colors.surface, colors.bgPanel);
  assert.equal(theme.spacing(2), 16);
  assert.equal(theme.radius, 14);
});
