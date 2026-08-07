/**
 * Semantic theme mapping sourced from the canonical shared tokens.
 *
 * Keeps the shape consumed by the field app so every platform resolves the
 * same values.
 */
import { colors, fontFamily } from "./tokens.ts";

export const theme = {
  colors: {
    background: colors.bg,
    surface: colors.bgPanel,
    surfaceAlt: colors.bgControl,
    border: colors.border,
    text: colors.text,
    textMuted: colors.textMuted,
    accent: colors.brandRed,
    accentMuted: colors.brandRedDark,
    bubbleVan: colors.brandRed,
    bubbleCommand: colors.bgControl,
    success: colors.green,
    warning: colors.amber,
    danger: colors.brandRed,
  },
  fontFamily,
  spacing: (n: number) => n * 8,
  radius: 14,
} as const;

export type Theme = typeof theme;
