// Search/filter helpers. Cross-route matches are surfaced separately so we
// can offer a one-tap route-switch when nothing matches in the active route.
// Ported verbatim from app/js/search.js; behavior is intentionally unchanged.

import type { Route, Sequence } from "@road-crew/contracts";

export type ParsedQuery =
  | { kind: "empty" }
  | { kind: "seq"; value: number }
  | { kind: "text"; value: string };

export function parseQuery(raw: string | null | undefined): ParsedQuery {
  const q = (raw || "").trim();
  if (!q) return { kind: "empty" };
  // "#47" or just "47" → jump
  const mNum = q.match(/^#?\s*(\d{1,4})$/);
  if (mNum) return { kind: "seq", value: Number(mNum[1]) };
  return { kind: "text", value: q.toLowerCase() };
}

export function matchSequence(seq: Sequence, parsed: ParsedQuery): boolean {
  if (parsed.kind === "empty") return true;
  if (parsed.kind === "seq") return seq.seq === parsed.value;
  const t = parsed.value;
  return Boolean(
    (seq.street && seq.street.toLowerCase().includes(t))
      || (seq.town && seq.town.toLowerCase().includes(t))
      || (seq.intersection && seq.intersection.toLowerCase().includes(t)),
  );
}

export function findCrossRouteMatches(
  allRoutes: Route[],
  activeRouteId: string,
  parsed: ParsedQuery,
): Array<{ route: Route; seq: Sequence }> {
  if (parsed.kind === "empty") return [];
  const out: Array<{ route: Route; seq: Sequence }> = [];
  for (const r of allRoutes) {
    if (r.id === activeRouteId) continue;
    for (const s of r.sequences) {
      if (matchSequence(s, parsed)) {
        out.push({ route: r, seq: s });
        if (out.length >= 5) return out;
      }
    }
  }
  return out;
}
