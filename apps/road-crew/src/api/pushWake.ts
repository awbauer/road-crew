import { apiFetch } from "@/api/client";
import type { BackgroundSyncOutcome } from "@/sync/backgroundHeartbeat";

/** Task-level results that are not a sync outcome. */
export type WakeOutcome = "ignored" | "failed";

/**
 * Tell the Worker what this device did with a silent wake.
 *
 * A wake that finds no van session sends no heartbeat, so without this call the
 * Worker cannot tell it apart from a push iOS never delivered — both look like
 * an accepted APNs request followed by silence. The acknowledgement is keyed on
 * the device id alone and deliberately does not require a session, because the
 * sessionless case is the one worth seeing.
 *
 * `syncRequestId` is nullable: an unrecognized payload acknowledges too, so a
 * wake that arrives but cannot be parsed shows up in Command instead of being
 * indistinguishable from one that never arrived at all.
 *
 * `skipped-van-install-disabled` is the one outcome that cannot arrive: that
 * build has no Worker API, so `apiFetch` rejects before sending. The caller
 * swallows it — the Worker still accepts the value so the contract stays whole.
 */
export async function reportWakeOutcome(
  syncRequestId: string | null,
  outcome: BackgroundSyncOutcome | WakeOutcome,
): Promise<void> {
  await apiFetch("/api/push/wake", {
    method: "POST",
    body: JSON.stringify({ syncRequestId, outcome }),
  });
}
