/**
 * Pure helpers for the live-location reporter.
 *
 * The reporter always sends the CURRENT fix on each 30s tick and never queues,
 * so a reconnect never flushes a backlog — "keep only the most recent update"
 * falls out of these predicates rather than an outbox.
 *
 * Authored as plain ESM (typed by locationReporter.d.ts) so it runs under
 * `node --test` without a TypeScript toolchain, matching the PWA's approach.
 */

// Default: don't report a fix older than 5 minutes — a stale cold-start fix
// shouldn't masquerade as the van's live position.
export const MAX_REPORT_FIX_AGE_MS = 5 * 60 * 1000;

// Should a foreground heartbeat attach GPS this tick? Every van install does,
// including one that has not selected a van yet. "Tracked" only controls the
// background task; it does not suppress the current foreground fix.
export function shouldAttachHeartbeatLocation({ vanInstall, hasFix, online }) {
  return Boolean(vanInstall) && Boolean(hasFix) && online !== false;
}

// Is this fix fresh enough to send? Guards against reporting a stale persisted
// fix as if it were live.
export function isFixReportable(fix, now = Date.now(), maxAgeMs = MAX_REPORT_FIX_AGE_MS) {
  if (!fix || typeof fix !== "object") return false;
  const lat = Number(fix.lat);
  const lng = Number(fix.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return false;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return false;
  const ts = Number(fix.ts);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return now - ts <= maxAgeMs;
}
