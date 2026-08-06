import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { PushRegistrationDiagnostics, PushRegistrationSource } from "./diagnostics.types";

const STORAGE_KEY = "rc.push-registration.diagnostics.v1";

type StoredPushDiagnostics = Omit<PushRegistrationDiagnostics, "support" | "permissions">;

const emptyStored = (): StoredPushDiagnostics => ({
  token: {
    status: Platform.OS !== "ios" ? "unsupported" : Device.isDevice ? "not-attempted" : "simulator",
    source: null,
    lastAttemptAt: null,
    acquiredAt: null,
    tokenLength: null,
    error: null,
  },
  registration: {
    status: "not-attempted",
    source: null,
    lastAttemptAt: null,
    registeredAt: null,
    workerDeviceId: null,
    workerPlatform: null,
    workerActive: null,
    workerRefreshedAt: null,
    httpStatus: null,
    error: null,
  },
});

let cached: StoredPushDiagnostics | null = null;
let loading: Promise<StoredPushDiagnostics> | null = null;
let writeQueue = Promise.resolve();

function isoNow(): string {
  return new Date().toISOString();
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return String(error).slice(0, 500);
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function isoFromMillis(value: unknown): string | null {
  const ms = typeof value === "number" ? value : Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

async function loadStored(): Promise<StoredPushDiagnostics> {
  if (cached) return cached;
  if (!loading) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return emptyStored();
        const parsed = JSON.parse(raw) as Partial<StoredPushDiagnostics>;
        return {
          ...emptyStored(),
          ...parsed,
          token: { ...emptyStored().token, ...parsed.token },
          registration: { ...emptyStored().registration, ...parsed.registration },
        };
      })
      .catch(() => emptyStored())
      .then((value) => {
        cached = value;
        return value;
      });
  }
  return loading;
}

async function save(next: StoredPushDiagnostics): Promise<void> {
  cached = next;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)));
  await writeQueue.catch(() => undefined);
}

async function update(mutator: (current: StoredPushDiagnostics) => StoredPushDiagnostics): Promise<void> {
  const current = await loadStored();
  await save(mutator(current));
}

export async function recordPushTokenAttempt(source: PushRegistrationSource): Promise<void> {
  await update((current) => ({
    ...current,
    token: { ...current.token, source, lastAttemptAt: isoNow(), error: null },
  }));
}

export async function recordPushTokenAcquired(source: PushRegistrationSource, token: string): Promise<void> {
  await update((current) => ({
    ...current,
    token: {
      ...current.token,
      status: "acquired",
      source,
      lastAttemptAt: isoNow(),
      acquiredAt: isoNow(),
      tokenLength: token.length,
      error: null,
    },
  }));
}

export async function recordPushTokenUnavailable(source: PushRegistrationSource, error: unknown): Promise<void> {
  await update((current) => ({
    ...current,
    token: {
      ...current.token,
      status: "unavailable",
      source,
      lastAttemptAt: isoNow(),
      tokenLength: null,
      error: errorSummary(error),
    },
  }));
}

export async function recordPushRegistrationAttempt(source: PushRegistrationSource): Promise<void> {
  await update((current) => ({
    ...current,
    registration: { ...current.registration, source, lastAttemptAt: isoNow(), error: null, httpStatus: null },
  }));
}

export async function recordPushRegistrationSkipped(source: PushRegistrationSource): Promise<void> {
  await update((current) => ({
    ...current,
    registration: { ...current.registration, status: "skipped", source, lastAttemptAt: isoNow(), error: null, httpStatus: null },
  }));
}

export async function recordPushRegistrationSuccess(
  source: PushRegistrationSource,
  registration: { deviceId?: unknown; platform?: unknown; active?: unknown; refreshedAt?: unknown },
): Promise<void> {
  await update((current) => ({
    ...current,
    registration: {
      ...current.registration,
      status: "registered",
      source,
      lastAttemptAt: isoNow(),
      registeredAt: isoNow(),
      workerDeviceId: typeof registration.deviceId === "string" ? registration.deviceId : null,
      workerPlatform: typeof registration.platform === "string" ? registration.platform : null,
      workerActive: typeof registration.active === "boolean" ? registration.active : null,
      workerRefreshedAt: isoFromMillis(registration.refreshedAt),
      httpStatus: 201,
      error: null,
    },
  }));
}

export async function recordPushRegistrationFailure(source: PushRegistrationSource, error: unknown): Promise<void> {
  await update((current) => ({
    ...current,
    registration: {
      ...current.registration,
      status: "failed",
      source,
      lastAttemptAt: isoNow(),
      httpStatus: errorStatus(error),
      error: errorSummary(error),
    },
  }));
}

export async function getPushRegistrationDiagnostics(): Promise<PushRegistrationDiagnostics> {
  const stored = await loadStored();
  let permissions: PushRegistrationDiagnostics["permissions"] = {
    checkedAt: isoNow(),
    status: null,
    granted: null,
    canAskAgain: null,
    iosAuthorizationStatus: null,
    allowsAlert: null,
    allowsBadge: null,
    allowsSound: null,
    allowsDisplayInNotificationCenter: null,
    allowsDisplayOnLockScreen: null,
    error: null,
  };
  if (Platform.OS !== "ios") {
    return {
      support: {
        platform: Platform.OS,
        physicalDevice: false,
        apnsEligible: false,
        backgroundRemoteNotificationsConfigured: false,
        signedApnsEntitlement: "not-verifiable-at-runtime",
      },
      permissions,
      ...stored,
    };
  }
  try {
    const response = await Notifications.getPermissionsAsync();
    permissions = {
      ...permissions,
      status: response.status,
      granted: response.granted,
      canAskAgain: response.canAskAgain,
      iosAuthorizationStatus: response.ios?.status ?? null,
      allowsAlert: response.ios?.allowsAlert ?? null,
      allowsBadge: response.ios?.allowsBadge ?? null,
      allowsSound: response.ios?.allowsSound ?? null,
      allowsDisplayInNotificationCenter: response.ios?.allowsDisplayInNotificationCenter ?? null,
      allowsDisplayOnLockScreen: response.ios?.allowsDisplayOnLockScreen ?? null,
    };
  } catch (error) {
    permissions.error = errorSummary(error);
  }
  return {
    support: {
      platform: Platform.OS,
      physicalDevice: Device.isDevice,
      apnsEligible: Platform.OS === "ios" && Device.isDevice,
      backgroundRemoteNotificationsConfigured: true,
      signedApnsEntitlement: "not-verifiable-at-runtime",
    },
    permissions,
    ...stored,
  };
}
