import type { VersionResponse } from "@road-crew/contracts";
import { apiFetch } from "@/api/client";
import { CONFIG } from "@/config";

/** Reads the deployed Worker version used by the automatic update check. */
export function fetchPublishedVersion(): Promise<VersionResponse> {
  return apiFetch<VersionResponse>(CONFIG.versionPath, {
    cache: "no-store",
    timeoutMs: CONFIG.requestTimeoutMs,
  });
}
