import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { isOnline } from "@/sync/network";
import {
  restoreResetPersistentSession,
  snapshotResetPersistentSession,
} from "@/auth/session";
import {
  restoreResetPersistentDeviceId,
  snapshotResetPersistentDeviceId,
} from "@/device/deviceId";
import { markPendingUpdatedState } from "./updatedToastState";
import { markLastRefreshed } from "./lastRefreshed";
import { metricCount } from "@/monitoring";

/** Thrown by updateApp/resetApp when the device is offline, so the caller
 * (the Status sheet's confirm button) can show "Offline — connect first". */
export class OfflineError extends Error {
  constructor() {
    super("offline");
  }
}

async function assertOnline(): Promise<void> {
  if (!(await isOnline())) throw new OfflineError();
}

async function unregisterServiceWorkerAndCaches(): Promise<void> {
  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* best effort */
    }
  }
  if (navigator.serviceWorker) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
    } catch {
      /* best effort */
    }
  }
}

async function reloadFresh(pathname = window.location.pathname): Promise<void> {
  await markLastRefreshed();
  // Keep the old document dark while the fresh bundle is being downloaded and
  // parsed. The exported HTML also has a dark root background, but this covers
  // the transition before the replacement document's head has been parsed.
  document.documentElement.style.backgroundColor = "#0b0b0d";
  if (document.body) document.body.style.backgroundColor = "#0b0b0d";
  window.location.href = `${pathname}?refreshed=${Date.now()}`;
}

/** Apply an update already identified by Expo without checking the channel a
 * second time. Both automatic and manual native update paths use this so the
 * confirmation survives the reload that activates the downloaded bundle. */
export async function applyAvailableNativeUpdate(): Promise<void> {
  await Updates.fetchUpdateAsync();
  await markPendingUpdatedState();
  await markLastRefreshed();
  await Updates.reloadAsync();
}

// Update: force a fresh service worker + caches (so a stale bundle can never
// keep serving old JS after a deploy) while PRESERVING settings/session, then
// reload. Requires connectivity, like legacy's runAppUpdate — an "update"
// while offline can't actually fetch anything newer.
export async function updateApp(): Promise<boolean> {
  const platform = Platform.OS;
  try {
    await assertOnline();
    if (platform === "web" && typeof window !== "undefined") {
      await markPendingUpdatedState();
      await unregisterServiceWorkerAndCaches();
      metricCount("road_crew.update_apply", 1, { outcome: "applying", platform });
      await reloadFresh();
      return true;
    }

    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) {
      metricCount("road_crew.update_apply", 1, { outcome: "current", platform });
      return false;
    }
    metricCount("road_crew.update_apply", 1, { outcome: "applying", platform });
    await applyAvailableNativeUpdate();
    return true;
  } catch (error) {
    metricCount("road_crew.update_apply", 1, { outcome: "error", platform });
    throw error;
  }
}

// Reset: wipe user settings/session + caches + service worker, then reload
// fresh. Install-level app attributes such as the persisted `vanInstall` flag
// and stable `deviceId` survive the reset.
export async function resetApp({ redirectPath = null }: { redirectPath?: string | null } = {}): Promise<void> {
  await assertOnline();
  const persistentSession = await snapshotResetPersistentSession();
  const persistentDeviceId = await snapshotResetPersistentDeviceId();
  try {
    await AsyncStorage.clear();
  } catch {
    /* best effort */
  }
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      window.localStorage.clear();
    } catch {
      /* best effort */
    }
  }
  await restoreResetPersistentSession(persistentSession);
  await restoreResetPersistentDeviceId(persistentDeviceId);
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  await unregisterServiceWorkerAndCaches();
  await reloadFresh(redirectPath || window.location.pathname);
}
