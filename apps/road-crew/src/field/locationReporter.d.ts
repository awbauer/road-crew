import type { Fix } from "./geolocation-types.ts";

export const MAX_REPORT_FIX_AGE_MS: number;

export function shouldAttachHeartbeatLocation(input: {
  vanInstall: boolean;
  hasFix: boolean;
  online: boolean;
}): boolean;

export function isFixReportable(
  fix: Fix | null | undefined,
  now?: number,
  maxAgeMs?: number,
): boolean;
