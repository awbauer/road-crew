// Ported verbatim from app/js/time.js; behavior is intentionally unchanged.

export function formatRelative(ts: number | null | undefined, now: number = Date.now()): string {
  if (!ts) return "never";
  const diff = Math.max(0, now - ts);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Default spread applied by `jitter`: +/-20% of the base interval. */
export const POLL_JITTER_RATIO = 0.2;

/**
 * Spread a fixed polling interval so a fleet of devices does not all call at
 * the same instant.
 *
 * Every device runs the same interval from whenever it launched, and the events
 * that force an off-schedule call — regaining connectivity, returning to the
 * foreground — are themselves correlated across a fleet (a cell site recovering,
 * a shift starting). That turns a steady request rate into spikes, and a spike
 * is what overloads a single-threaded Durable Object. Re-rolling the delay each
 * tick also stops devices that started together from staying in lockstep.
 *
 * Returns `baseMs` scaled by a random factor in `[1 - ratio, 1 + ratio]`.
 */
export function jitter(baseMs: number, ratio: number = POLL_JITTER_RATIO): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;
  const spread = Math.min(Math.max(ratio, 0), 1);
  return Math.round(baseMs * (1 + (Math.random() * 2 - 1) * spread));
}
