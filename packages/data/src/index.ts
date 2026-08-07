/**
 * Cross-platform loader for baked route data used by web and native clients.
 *
 * Pass `baseUrl: ""` (default) for the web same-origin case and the resolved
 * absolute Worker origin for native. A custom `fetchImpl` can be injected for
 * tests.
 */

import type { Route, RouteData, RoutePath, Van } from "@road-crew/contracts";

export { CUMBERLAND_FARMS } from "./cumberlandFarms.ts";

// Detour sequences (900s) are appended at the end by the pipeline but must
// appear inline in the list. Each entry: detour seq numbers to splice in after
// a given anchor seq number.
const DETOUR_INSERTS: ReadonlyArray<{ afterSeq: number; detourSeqs: number[] }> = [
  { afterSeq: 205, detourSeqs: [901, 902, 903, 904] },
  { afterSeq: 230, detourSeqs: [905, 906] },
];

// Route IDs that have a corresponding path file in data/paths/.
const PATH_ROUTE_IDS = [
  "day1_route1",
  "day1_route2",
  "day2_route1",
  "day2_route2",
  "day2_route3",
];

export interface LoadOptions {
  /** "" for web same-origin; the absolute Worker origin for native. */
  baseUrl?: string;
  /** Injectable fetch (defaults to the global). */
  fetchImpl?: typeof fetch;
  /** Bypass the in-memory payload after connectivity is restored. */
  forceRefresh?: boolean;
}

// Non-fatal warnings collected during load (e.g. dropped detour sequences).
const dataWarnings: string[] = [];

export function getDataWarnings(): string[] {
  return dataWarnings.slice();
}

function applyDetourOrder(route: Route): void {
  const seqs = route.sequences;
  if (!Array.isArray(seqs)) return; // shape guarded again by validateRouteData
  const byNum = new Map(seqs.map((s) => [s.seq, s]));
  const detourSet = new Set(DETOUR_INSERTS.flatMap((d) => d.detourSeqs));

  // Base list: everything that isn't a detour, in original order.
  const base = seqs.filter((s) => !detourSet.has(s.seq));

  for (const { afterSeq, detourSeqs } of DETOUR_INSERTS) {
    if (!byNum.has(afterSeq) && !base.some((s) => s.seq === afterSeq)) {
      // Anchor absent — only warn for routes that actually carry these detours.
      if (detourSeqs.some((n) => byNum.has(n))) {
        dataWarnings.push(`${route.id}: detour anchor seq ${afterSeq} missing; detour ${detourSeqs.join("/")} left at end.`);
      }
      continue;
    }
    const anchorIdx = base.findIndex((s) => s.seq === afterSeq);
    if (anchorIdx < 0) continue;
    const present = detourSeqs.filter((n) => byNum.has(n));
    const missing = detourSeqs.filter((n) => !byNum.has(n));
    if (missing.length) {
      dataWarnings.push(`${route.id}: detour seq ${missing.join("/")} not found in payload.`);
    }
    const toInsert = present.map((n) => byNum.get(n)!);
    base.splice(anchorIdx + 1, 0, ...toInsert);
  }

  route.sequences = base;
}

function getFetch(opts: LoadOptions): typeof fetch {
  const impl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
  if (!impl) throw new Error("No fetch implementation available.");
  return impl;
}

let payload: RouteData | null = null;

export async function loadSequences(opts: LoadOptions = {}): Promise<RouteData> {
  if (payload && !opts.forceRefresh) return payload;
  const base = opts.baseUrl ?? "";
  const doFetch = getFetch(opts);

  const resp = await doFetch(`${base}/data/sequences.json`, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`Failed to load sequences.json: ${resp.status}`);
  let parsed: RouteData;
  try {
    parsed = await resp.json();
  } catch (_) {
    throw new Error("Route data is corrupted (could not be parsed).");
  }
  if (
    !parsed
    || !Array.isArray(parsed.routes)
    || parsed.routes.length === 0
    || parsed.routes.some((route) => !route || typeof route !== "object" || !Array.isArray(route.sequences))
  ) {
    throw new Error("Route data is malformed (no routes found).");
  }
  const nextPayload = parsed;
  nextPayload.routes.forEach(applyDetourOrder);

  // Attach path coordinate arrays to routes that have them. Failures are
  // non-fatal — the route works without path data.
  await Promise.all(
    nextPayload.routes.map(async (route) => {
      if (!PATH_ROUTE_IDS.includes(route.id)) return;
      try {
        const pr = await doFetch(`${base}/data/paths/${route.id}.json`);
        if (pr.ok) route.path = (await pr.json()) as RoutePath;
      } catch (_) {
        /* offline or missing — degrade gracefully */
      }
    }),
  );

  payload = nextPayload;
  return nextPayload;
}

let vansPayload: { vans: Van[] } | null = null;

// Loads the van roster used for notification targeting and the van-number
// setting. Prefer the Worker-backed API so admin changes are visible without a
// redeploy; fall back to the baked static file for local static serving.
export async function loadVans(opts: LoadOptions = {}): Promise<{ vans: Van[] }> {
  if (vansPayload) return vansPayload;
  const base = opts.baseUrl ?? "";
  const doFetch = getFetch(opts);

  for (const path of [`${base}/api/vans`, `${base}/data/vans.json`]) {
    try {
      const resp = await doFetch(path, { cache: "no-cache" });
      if (!resp.ok) continue;
      const parsed = await resp.json();
      if (parsed && Array.isArray(parsed.vans)) {
        vansPayload = parsed as { vans: Van[] };
        return vansPayload;
      }
    } catch (_) {
      // Try the next source.
    }
  }
  vansPayload = { vans: [] };
  return vansPayload;
}

export function getRouteById(data: RouteData | null | undefined, id: string): Route | null {
  if (!data) return null;
  return data.routes.find((r) => r.id === id) || null;
}

export function generatedAtMs(data: RouteData | null | undefined): number {
  if (!data || !data.generated_at) return 0;
  const t = Date.parse(data.generated_at);
  return isNaN(t) ? 0 : t;
}

/** Clears the module-level caches. Primarily for tests. */
export function resetDataCache(): void {
  payload = null;
  vansPayload = null;
  dataWarnings.length = 0;
}
