import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { addBreadcrumb, captureError } from "@/monitoring";

const KEYS = {
  clientId: "rc.auth.cfAccessClientId",
  clientSecret: "rc.auth.cfAccessClientSecret",
} as const;

/**
 * Keychain items default to `kSecAttrAccessibleWhenUnlocked`, which makes them
 * unreadable whenever the screen is locked. A van phone spends the ride locked
 * in its cradle while background heartbeats and location reports fire, and each
 * of those needs the Access service token — so the default guaranteed a
 * "User interaction is not allowed" throw in exactly the case the app exists
 * for. After-first-unlock keeps the token readable from the moment the crew
 * unlocks the phone once per boot; `THIS_DEVICE_ONLY` keeps it out of backups
 * and off any device the backup is restored onto.
 */
const KEYCHAIN_OPTIONS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
} as const;

export interface CloudflareAccessCredentials {
  clientId: string;
  clientSecret: string;
}

function buildCredentials(clientId: string | undefined, clientSecret: string | undefined): CloudflareAccessCredentials | null {
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function buildCredentialsFromBuildEnv(): CloudflareAccessCredentials | null {
  return buildCredentials(
    process.env.EXPO_PUBLIC_CF_ACCESS_CLIENT_ID,
    process.env.EXPO_PUBLIC_CF_ACCESS_CLIENT_SECRET,
  );
}

async function readStoredCredentials(): Promise<CloudflareAccessCredentials | null> {
  const [clientId, clientSecret] = await Promise.all([
    SecureStore.getItemAsync(KEYS.clientId),
    SecureStore.getItemAsync(KEYS.clientSecret),
  ]);
  return buildCredentials(clientId || undefined, clientSecret || undefined);
}

async function storeCredentials(credentials: CloudflareAccessCredentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.clientId, credentials.clientId, KEYCHAIN_OPTIONS),
    SecureStore.setItemAsync(KEYS.clientSecret, credentials.clientSecret, KEYCHAIN_OPTIONS),
  ]);
}

/**
 * Accessibility is fixed when an item is written, so every install that already
 * seeded its token holds a locked-out copy until something rewrites it. The
 * first read that succeeds — which by definition happened while unlocked — puts
 * the same values back under the new attribute. Once per launch is enough; a
 * failure here is not worth reporting, since the next launch retries.
 */
let migratedThisLaunch = false;
async function migrateKeychainAccessibility(credentials: CloudflareAccessCredentials): Promise<void> {
  if (migratedThisLaunch) return;
  migratedThisLaunch = true;
  try {
    await storeCredentials(credentials);
  } catch (error) {
    addBreadcrumb("cf_access_keychain_migration_failed", { error: String(error) });
  }
}

/**
 * errSecInteractionNotAllowed — the device was locked when we read. Expected on
 * a cradled phone, and self-correcting, so it is a breadcrumb rather than an
 * error report. Anything else is a genuine Keychain fault worth seeing.
 */
function isDeviceLockedError(error: unknown): boolean {
  return /User interaction is not allowed/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Reads the local Access service token from Keychain/Keystore. For an internal
 * build, the first native launch may seed SecureStore from the build-local
 * EXPO_PUBLIC_* values; subsequent requests use SecureStore only.
 */
export async function getCloudflareAccessCredentials(): Promise<CloudflareAccessCredentials | null> {
  if (Platform.OS === "web") return null;
  try {
    const stored = await readStoredCredentials();
    if (stored) {
      await migrateKeychainAccessibility(stored);
      return stored;
    }

    const fromBuild = buildCredentialsFromBuildEnv();
    if (fromBuild) {
      await storeCredentials(fromBuild);
      return fromBuild;
    }
  } catch (error) {
    if (isDeviceLockedError(error)) {
      addBreadcrumb("cf_access_keychain_locked", { error: String(error) });
    } else {
      captureError(error, { tags: { source: "cloudflare_access_credentials" } });
    }
  }
  return null;
}

/** Initializes the native credential store without exposing the secret to callers. */
export async function initializeCloudflareAccessCredentials(): Promise<void> {
  await getCloudflareAccessCredentials();
}

export async function getCloudflareAccessHeaders(): Promise<Record<string, string>> {
  const credentials = await getCloudflareAccessCredentials();
  if (!credentials) return {};
  return {
    "CF-Access-Client-Id": credentials.clientId,
    "CF-Access-Client-Secret": credentials.clientSecret,
  };
}
