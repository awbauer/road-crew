// Ported from app/js/main.js computeStatus — behavior is intentionally
// unchanged. One consolidated status summarizing GPS + network + data
// freshness, worst-issue-wins.

export interface AppStatusInput {
  hasFix: boolean;
  /** The GPS fix's timestamp (ms epoch), if `hasFix` is true. */
  fixTs: number | null;
  online: boolean;
  /** True when this reporting van's latest location upload failed. */
  locationReportFailed?: boolean;
  /** True for a van install whose tracking is currently paused. */
  trackingPaused?: boolean;
  /**
   * When the route data was built (ms epoch); null when unknown. Unknown age
   * is not reported as stale.
   */
  dataGeneratedAtMs: number | null;
  validationIssueCount: number;
  /** Injectable for deterministic tests; defaults to `Date.now()`. */
  nowMs?: number;
}

export interface AppStatus {
  /**
   * `untracked` is not a problem level — it reports that this van install is
   * deliberately not sharing its location, and only wins when nothing more
   * urgent applies.
   */
  level: "red" | "amber" | "green" | "untracked";
  label: string;
}

const GPS_LOST_SECONDS = 120;
const GPS_STALE_SECONDS = 30;
const DATA_STALE_SECONDS = 30 * 86400;

export function computeAppStatus(input: AppStatusInput): AppStatus {
  const now = input.nowMs ?? Date.now();
  const fixAgeSeconds = input.hasFix && input.fixTs != null ? (now - input.fixTs) / 1000 : Infinity;
  const dataAgeSeconds =
    input.dataGeneratedAtMs != null && Number.isFinite(input.dataGeneratedAtMs)
      ? (now - input.dataGeneratedAtMs) / 1000
      : null;

  if (!input.hasFix) return { level: "red", label: "No GPS" };
  if (fixAgeSeconds > GPS_LOST_SECONDS) return { level: "red", label: "GPS lost" };
  if (!input.online && fixAgeSeconds > GPS_STALE_SECONDS) return { level: "amber", label: "Offline · GPS stale" };
  if (!input.online) return { level: "amber", label: "Offline" };
  if (fixAgeSeconds > GPS_STALE_SECONDS) return { level: "amber", label: "GPS stale" };
  if (input.locationReportFailed) return { level: "amber", label: "Location issue" };
  if (dataAgeSeconds != null && dataAgeSeconds > DATA_STALE_SECONDS) return { level: "amber", label: "Data >30d old" };
  if (input.validationIssueCount > 0) return { level: "amber", label: "Data issue" };
  // Lowest priority: every real problem above still gets reported first.
  if (input.trackingPaused) return { level: "untracked", label: "Untracked" };
  return { level: "green", label: "Live" };
}
