import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_HEARTBEAT_KEY = "rc.lastHeartbeatAt";

/** Persist the last successful heartbeat without making the network path fail. */
export async function recordLastHeartbeatAt(at = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_HEARTBEAT_KEY, String(at));
  } catch {
    // The in-memory timestamp still serves the foreground UI when storage is
    // unavailable, and the next successful heartbeat retries this write.
  }
}

export async function getLastHeartbeatAt(): Promise<number | null> {
  try {
    const value = Number(await AsyncStorage.getItem(LAST_HEARTBEAT_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
