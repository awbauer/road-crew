import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { APP_VERSION } from "@road-crew/config";
import { apiFetch } from "@/api/client";
import { addBreadcrumb, captureError, captureMessage, metricCount } from "@/monitoring";
import {
  recordPushRegistrationAttempt,
  recordPushRegistrationFailure,
  recordPushRegistrationSkipped,
  recordPushRegistrationSuccess,
  recordPushTokenAcquired,
  recordPushTokenAttempt,
  recordPushTokenUnavailable,
} from "./diagnostics";
import type { PushRegistrationSource } from "./diagnostics.types";

/**
 * Native push registration for silent Command tracking wakes.
 *
 * This first push path intentionally does not request notification presentation
 * permission and does not collect Expo push tokens. The native APNs token is
 * enough for a silent background notification.
 */

export interface PushTokens {
  /** Kept for the existing Status sheet contract; never populated. */
  expoPushToken: string | null;
  /** Raw APNs device token on iOS. */
  devicePushToken: string | null;
  platform: typeof Platform.OS;
}

let configured = false;

/** Keep silent sync payloads out of the foreground notification UI. */
export function configureNotificationHandler(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.type === "sync-request") {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
      };
    },
  });
}

/**
 * Retained for the explicit Status-sheet setup action. Silent registration does
 * not call this function or prompt the driver.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    addBreadcrumb("push permission skipped on simulator", { platform: Platform.OS });
    return false;
  }
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") addBreadcrumb("push permission not granted", { status, platform: Platform.OS });
  return status === "granted";
}

/** Acquire the native APNs token without requesting user-facing permission. */
export async function acquirePushTokens(source: PushRegistrationSource = "boot"): Promise<PushTokens> {
  const result: PushTokens = {
    expoPushToken: null,
    devicePushToken: null,
    platform: Platform.OS,
  };
  if (Platform.OS !== "ios" || !Device.isDevice) return result;

  await recordPushTokenAttempt(source);
  try {
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    result.devicePushToken = String(deviceToken.data);
    await recordPushTokenAcquired(source, result.devicePushToken);
  } catch (error) {
    await recordPushTokenUnavailable(source, error);
    metricCount("road_crew.push_registration", 1, { outcome: "token_error", platform: Platform.OS });
    addBreadcrumb("device push token unavailable", { platform: Platform.OS });
    captureError(error, { tags: { source: "push_device_token" }, extra: { platform: Platform.OS } });
  }
  if (result.devicePushToken) {
    metricCount("road_crew.push_registration", 1, { outcome: "token_acquired", platform: Platform.OS });
  }
  if (!result.devicePushToken) {
    metricCount("road_crew.push_registration", 1, { outcome: "token_unavailable", platform: Platform.OS });
    captureMessage("No native APNs token was available for silent Command sync.", "warning");
  }
  return result;
}

/** Register the native token with the Worker for silent tracking wakes. */
export async function registerPushToken(
  vanId: string,
  tokens: PushTokens,
  source: PushRegistrationSource = "boot",
): Promise<void> {
  if (!tokens.devicePushToken || tokens.platform !== "ios") {
    await recordPushRegistrationSkipped(source);
    metricCount("road_crew.push_registration", 1, { outcome: "skipped", platform: tokens.platform });
    return;
  }
  try {
    await recordPushRegistrationAttempt(source);
    const response = await apiFetch<{ registration?: { deviceId?: unknown; platform?: unknown; active?: unknown; refreshedAt?: unknown } }>("/api/push/register", {
      method: "POST",
      body: JSON.stringify({
        devicePushToken: tokens.devicePushToken,
        platform: tokens.platform,
        appRelease: APP_VERSION.release,
        appBuild: APP_VERSION.build,
      }),
    });
    await recordPushRegistrationSuccess(source, response.registration || {});
    metricCount("road_crew.push_registration", 1, { outcome: "registered", platform: tokens.platform });
    addBreadcrumb("push token registered", {
      vanId,
      platform: tokens.platform,
      registered: true,
    });
  } catch (error) {
    await recordPushRegistrationFailure(source, error);
    metricCount("road_crew.push_registration", 1, { outcome: "registration_error", platform: tokens.platform });
    throw error;
  }
}

// ---------- native badge counts ----------

export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch (error) {
    addBreadcrumb("badge update failed", {
      count: Math.max(0, count),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function clearBadge(): Promise<void> {
  await setBadgeCount(0);
}
