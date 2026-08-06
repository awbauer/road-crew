import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureError } from "@/monitoring";

/**
 * Session / van context.
 *
 * The public van-messaging API is not behind Cloudflare Access (only the
 * Command/admin side is), so a driver's "session" is their selected van
 * identity plus optional route context. This module persists that selection so
 * the app reconnects to the right conversation across restarts. It is the seam
 * where a real device/identity token (for push registration and any future
 * authenticated endpoints) will be attached — see push/registration.ts.
 */

const KEYS = {
  vanId: "rc.session.vanId",
  routeId: "rc.session.routeId",
  // Set once the build has marked this as a van-install app. This is an app
  // attribute, not a user-editable setting: installed van devices keep using
  // the van-install flow until they choose a van again.
  vanInstall: "rc.session.vanInstall",
  // Set when a van-install device dismisses the picker without choosing a van.
  // Reset App clears this so the setup prompt can appear again.
  vanInstallSkipped: "rc.session.vanInstallSkipped",
  // Set true only when the crew picks a van through the van-install flow, so a
  // normal field-guide user (no van) never reports its location.
  reportingVan: "rc.session.reportingVan",
  // Command-controlled flag delivered on every heartbeat. Unlike vanId/routeId
  // this is a device attribute, not a driver choice, so it survives sign-out
  // and van changes the same way vanInstall does.
  remoteTrackingEnabled: "rc.session.remoteTrackingEnabled",
  // Worker-authoritative fleet-wide policy. Persisting this keeps a device
  // locked off across restarts, offline launches, and Reset App until a later
  // heartbeat explicitly unlocks it.
  locationTrackingAllowed: "rc.session.locationTrackingAllowed",
} as const;

export interface Session {
  vanId: string | null;
  routeId: string | null;
  vanInstall: boolean;
  vanInstallConfigured: boolean;
  vanInstallSkipped: boolean;
  reportingVan: boolean;
  /** Whether Command currently allows this device to report its GPS location. */
  remoteTrackingEnabled: boolean;
  /** Whether the Worker currently permits any van location reporting. */
  locationTrackingAllowed: boolean;
}

/**
 * Session writers that are not React — the background location task and the
 * silent-push sync — write straight through this module. Without a change
 * signal their writes never reach SessionProvider's state, so the UI shows a
 * stale value and, worse, the foreground heartbeat keeps re-asserting the value
 * it still holds in a ref, undoing what the background just applied. Every
 * mutator below notifies so there is one source of truth with many readers.
 */
const listeners = new Set<() => void>();

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifySessionChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      // A bad subscriber must never fail the write that already landed.
      captureError(error, { tags: { source: "session_subscriber" } });
    }
  }
}

export async function loadSession(): Promise<Session> {
  try {
    const [
      vanId,
      routeId,
      vanInstall,
      vanInstallSkipped,
      reportingVan,
      remoteTrackingEnabled,
      locationTrackingAllowed,
    ] = await Promise.all([
      AsyncStorage.getItem(KEYS.vanId),
      AsyncStorage.getItem(KEYS.routeId),
      AsyncStorage.getItem(KEYS.vanInstall),
      AsyncStorage.getItem(KEYS.vanInstallSkipped),
      AsyncStorage.getItem(KEYS.reportingVan),
      AsyncStorage.getItem(KEYS.remoteTrackingEnabled),
      AsyncStorage.getItem(KEYS.locationTrackingAllowed),
    ]);
    const trackingAllowed = locationTrackingAllowed !== "false";
    return {
      vanId: vanId || null,
      routeId: routeId || null,
      vanInstall: vanInstall === "true",
      vanInstallConfigured: vanInstall !== null,
      vanInstallSkipped: vanInstallSkipped === "true",
      reportingVan: reportingVan === "true",
      remoteTrackingEnabled: trackingAllowed && remoteTrackingEnabled !== "false",
      locationTrackingAllowed: trackingAllowed,
    };
  } catch (error) {
    captureError(error, { tags: { source: "session_load" } });
    return {
      vanId: null,
      routeId: null,
      vanInstall: false,
      vanInstallConfigured: false,
      vanInstallSkipped: false,
      reportingVan: false,
      remoteTrackingEnabled: true,
      locationTrackingAllowed: true,
    };
  }
}

export async function setSessionVan(vanId: string | null): Promise<void> {
  try {
    if (vanId) await AsyncStorage.setItem(KEYS.vanId, vanId);
    else await AsyncStorage.removeItem(KEYS.vanId);
    notifySessionChanged();
  } catch (error) {
    captureError(error, { tags: { source: "session_set_van" }, extra: { hasVanId: Boolean(vanId) } });
    throw error;
  }
}

export async function setReportingVan(reporting: boolean): Promise<void> {
  try {
    if (reporting) await AsyncStorage.setItem(KEYS.reportingVan, "true");
    else await AsyncStorage.removeItem(KEYS.reportingVan);
    notifySessionChanged();
  } catch (error) {
    captureError(error, { tags: { source: "session_set_reporting" }, extra: { reporting } });
    throw error;
  }
}

export async function setRemoteTrackingEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.remoteTrackingEnabled, enabled ? "true" : "false");
    notifySessionChanged();
  } catch (error) {
    captureError(error, { tags: { source: "session_set_remote_tracking_enabled" }, extra: { enabled } });
    throw error;
  }
}

export async function setLocationTrackingPolicy(
  allowed: boolean,
  trackingEnabled: boolean,
): Promise<void> {
  const appliedTrackingEnabled = allowed && trackingEnabled;
  try {
    await AsyncStorage.multiSet([
      [KEYS.locationTrackingAllowed, allowed ? "true" : "false"],
      [KEYS.remoteTrackingEnabled, appliedTrackingEnabled ? "true" : "false"],
    ]);
    notifySessionChanged();
  } catch (error) {
    captureError(error, {
      tags: { source: "session_set_location_tracking_policy" },
      extra: { allowed, trackingEnabled: appliedTrackingEnabled },
    });
    throw error;
  }
}

export async function setVanInstall(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.vanInstall, enabled ? "true" : "false");
    notifySessionChanged();
  } catch (error) {
    captureError(error, { tags: { source: "session_set_van_install" }, extra: { enabled } });
    throw error;
  }
}

export async function setVanInstallSkipped(skipped: boolean): Promise<void> {
  try {
    if (skipped) await AsyncStorage.setItem(KEYS.vanInstallSkipped, "true");
    else await AsyncStorage.removeItem(KEYS.vanInstallSkipped);
    notifySessionChanged();
  } catch (error) {
    captureError(error, { tags: { source: "session_set_van_install_skipped" }, extra: { skipped } });
    throw error;
  }
}

export async function setSessionRoute(routeId: string | null): Promise<void> {
  try {
    if (routeId) await AsyncStorage.setItem(KEYS.routeId, routeId);
    else await AsyncStorage.removeItem(KEYS.routeId);
    notifySessionChanged();
  } catch (error) {
    captureError(error, { tags: { source: "session_set_route" }, extra: { hasRouteId: Boolean(routeId) } });
    throw error;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEYS.vanId, KEYS.routeId, KEYS.reportingVan, KEYS.vanInstallSkipped]);
    notifySessionChanged();
  } catch (error) {
    captureError(error, { tags: { source: "session_clear" } });
    throw error;
  }
}

export async function snapshotResetPersistentSession(): Promise<[string, string][]> {
  try {
    return (await AsyncStorage.multiGet([
      KEYS.vanInstall,
      KEYS.remoteTrackingEnabled,
      KEYS.locationTrackingAllowed,
    ])).flatMap(([key, value]) =>
      typeof value === "string" && value.length > 0 ? [[key, value]] : [],
    );
  } catch (error) {
    captureError(error, { tags: { source: "session_snapshot_persistent" } });
    return [];
  }
}

export async function restoreResetPersistentSession(entries: [string, string][]): Promise<void> {
  if (!entries.length) return;
  try {
    await AsyncStorage.multiSet(entries);
  } catch (error) {
    captureError(error, { tags: { source: "session_restore_persistent" } });
  }
}
