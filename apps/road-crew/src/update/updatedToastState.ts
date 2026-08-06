import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_TOAST_KEY = "rc.pendingUpdatedVersion";
const PENDING_NOTIFICATION_KEY = "rc.pendingUpdatedNotification";

/** Persist the result across the reload that actually activates an update.
 * The toast and Notification Center each consume their own marker so showing
 * one never prevents the other from recording the completed update. */
export async function markPendingUpdatedState(): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [PENDING_TOAST_KEY, "1"],
      [PENDING_NOTIFICATION_KEY, "1"],
    ]);
  } catch {
    // A missed confirmation should never block an update.
  }
}

export async function consumePendingUpdatedToast(): Promise<boolean> {
  const pending = await AsyncStorage.getItem(PENDING_TOAST_KEY);
  if (!pending) return false;
  await AsyncStorage.removeItem(PENDING_TOAST_KEY);
  return true;
}

export async function consumePendingUpdatedNotification(): Promise<boolean> {
  const pending = await AsyncStorage.getItem(PENDING_NOTIFICATION_KEY);
  if (!pending) return false;
  await AsyncStorage.removeItem(PENDING_NOTIFICATION_KEY);
  return true;
}
