export type BackgroundSyncOutcome =
  | "synced"
  | "skipped-no-session"
  | "skipped-not-reporting"
  | "skipped-van-install-disabled";

export declare function syncBackgroundCommandState(input?: {
  backgroundSyncRequestId?: string | null;
  heartbeatSource?: "scheduled-task" | "silent-push";
}): Promise<BackgroundSyncOutcome>;

export declare function syncBackgroundHeartbeatRegistration(enabled: boolean): Promise<void>;
