import AsyncStorage from "@react-native-async-storage/async-storage";

// Timestamp of the last Fetch latest OTA / Reset App action (either one — mirrors
// legacy's single KEYS.lastResetAt, written by both flows). Shown in the
// Status sheet as "App last reset".
const KEY = "rc.lastRefreshedAt";

export async function markLastRefreshed(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* best effort */
  }
}

export async function getLastRefreshedAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const ms = raw ? Number(raw) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
