export type PushRegistrationSource = "boot" | "token-refresh" | "status-sheet" | "heartbeat-recovery";

export interface PushRegistrationDiagnostics {
  support: {
    platform: string;
    physicalDevice: boolean;
    apnsEligible: boolean;
    /** Declared by the Expo notifications plugin; the signed entitlement is only inspectable from the IPA. */
    backgroundRemoteNotificationsConfigured: boolean;
    signedApnsEntitlement: "not-verifiable-at-runtime";
  };
  permissions: {
    checkedAt: string | null;
    status: string | null;
    granted: boolean | null;
    canAskAgain: boolean | null;
    iosAuthorizationStatus: number | null;
    allowsAlert: boolean | null;
    allowsBadge: boolean | null;
    allowsSound: boolean | null;
    allowsDisplayInNotificationCenter: boolean | null;
    allowsDisplayOnLockScreen: boolean | null;
    error: string | null;
  };
  token: {
    status: "not-attempted" | "acquired" | "unavailable" | "unsupported" | "simulator";
    source: PushRegistrationSource | null;
    lastAttemptAt: string | null;
    acquiredAt: string | null;
    tokenLength: number | null;
    error: string | null;
  };
  registration: {
    status: "not-attempted" | "registered" | "failed" | "skipped";
    source: PushRegistrationSource | null;
    lastAttemptAt: string | null;
    registeredAt: string | null;
    workerDeviceId: string | null;
    workerPlatform: string | null;
    workerActive: boolean | null;
    workerRefreshedAt: string | null;
    httpStatus: number | null;
    error: string | null;
  };
}

