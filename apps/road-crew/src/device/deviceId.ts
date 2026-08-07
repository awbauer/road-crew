import AsyncStorage from "@react-native-async-storage/async-storage";

export const DEVICE_ID_HEADER = "x-rc-device-id";

const DEVICE_ID_KEY = "rc-device-id";
const DEVICE_ID_PATTERN = /^d_[a-z0-9]{10}$/;
let cachedDeviceId: string | null = null;
let pendingDeviceId: Promise<string> | null = null;

function randomBase36(length: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const cryptoApi =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? (globalThis.crypto as { getRandomValues?: (array: Uint8Array) => Uint8Array })
      : null;

  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  let id = "";
  for (let i = 0; i < length; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function createDeviceId(): string {
  return `d_${randomBase36(10)}`;
}

async function loadOrCreateDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) {
      cachedDeviceId = stored;
      return stored;
    }
  } catch {
    // Fall through and use an in-memory id for this process.
  }

  const next = createDeviceId();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  } catch {
    // Best effort: request/monitoring context is still useful for this launch.
  }
  cachedDeviceId = next;
  return next;
}

export async function snapshotResetPersistentDeviceId(): Promise<[string, string][]> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    return stored && DEVICE_ID_PATTERN.test(stored) ? [[DEVICE_ID_KEY, stored]] : [];
  } catch {
    return [];
  }
}

export async function restoreResetPersistentDeviceId(entries: [string, string][]): Promise<void> {
  if (!entries.length) return;
  const [, deviceId] = entries[0];
  try {
    await AsyncStorage.multiSet(entries);
    if (DEVICE_ID_PATTERN.test(deviceId)) cachedDeviceId = deviceId;
  } catch {
    /* best effort */
  }
}

/**
 * Returns the stable anonymous install identifier. It survives normal launches,
 * app updates, and app resets.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  if (!pendingDeviceId) {
    pendingDeviceId = loadOrCreateDeviceId().finally(() => {
      pendingDeviceId = null;
    });
  }
  return pendingDeviceId;
}
