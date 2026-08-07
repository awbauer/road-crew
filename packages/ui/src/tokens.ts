/**
 * Design tokens — the single source of truth for appearance across web + native.
 *
 * These were ported verbatim from the retired field PWA and now form the
 * canonical palette for the universal app. Do not invent parallel values.
 */

/** Canonical field-app color tokens. */
export const colors = {
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

/** Canonical web/native system-font stack. */
export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

export type Colors = typeof colors;
