import { isLikelyTransientError } from "../lib/errors.ts";

export type OutboxFailureStatus = "failed" | "queued";

/** Keep recoverable transport failures queued for automatic reconciliation. */
export function outboxFailureStatus(error: unknown, online: boolean): OutboxFailureStatus {
  return !online || isLikelyTransientError(error) ? "queued" : "failed";
}
