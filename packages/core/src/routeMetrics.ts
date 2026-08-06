// Ported verbatim from app/js/routeMetrics.js; behavior is intentionally unchanged.

import type { Route, Sequence } from "@road-crew/contracts";
import { sequenceFlags } from "./sequence.ts";

export function nextSignificantSequence(
  route: Route | null | undefined,
  fromIndex: number | null | undefined,
): { index: number; seq: Sequence } | null {
  if (!route || fromIndex == null || fromIndex < 0) return null;
  for (let i = fromIndex + 1; i < route.sequences.length; i += 1) {
    const seq = route.sequences[i];
    if (sequenceFlags(seq).length || seq.dir === "L" || seq.dir === "R") return { index: i, seq };
  }
  return null;
}
