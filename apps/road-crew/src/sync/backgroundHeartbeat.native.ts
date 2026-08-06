import * as BackgroundTask from "expo-background-task";
import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import { fetchVanMessages } from "@/api/messages";
import { isUnavailableError } from "@/api/client";
import { sendHeartbeat } from "@/api/heartbeat";
import {
  clearSession,
  loadSession,
  setLocationTrackingPolicy,
  setSessionRoute,
} from "@/auth/session";
import { applyBackgroundLocationPolicy, syncBackgroundLocationReporting } from "@/field/backgroundLocation";
import { resolveHeartbeatTrackingState } from "@/field/trackingPolicy";
import { CONFIG } from "@/config";
import { getLastServerSeq, upsertServerMessages } from "@/db/messageRepository";
import { errorMessage } from "@/lib/errors";
import { addBreadcrumb, captureError, metricCount, metricDistribution } from "@/monitoring";

export const BACKGROUND_HEARTBEAT_TASK = "rc-background-heartbeat";

// Native schedulers treat this as a lower bound, not a promise of a precise
// cadence. The foreground provider remains responsible for the 30-second path.
const BACKGROUND_HEARTBEAT_MIN_INTERVAL_MINUTES = 15;

/**
 * Why a background sync produced no heartbeat. `synced` is the only outcome
 * that advances Last seen; the rest are deliberate no-ops that were previously
 * indistinguishable from a wake that never ran at all.
 */
export type BackgroundSyncOutcome =
  | "synced"
  | "skipped-no-session"
  | "skipped-not-reporting"
  | "skipped-van-install-disabled";

export async function syncBackgroundCommandState({
  backgroundSyncRequestId = null,
  heartbeatSource = "scheduled-task",
}: {
  backgroundSyncRequestId?: string | null;
  heartbeatSource?: "scheduled-task" | "silent-push";
} = {}): Promise<BackgroundSyncOutcome> {
  const session = await loadSession();
  // Report which gate stopped the sync. A wake that reaches a device with no
  // van session does everything right and still moves nothing, so the reason
  // has to leave the device or the failure is invisible on both ends.
  if (!CONFIG.vanInstallEnabled) return "skipped-van-install-disabled";
  if (!session.vanId) return "skipped-no-session";
  if (!session.reportingVan) return "skipped-not-reporting";

  const heartbeat = await sendHeartbeat({
    location: null,
    vanId: session.vanId,
    routeId: session.routeId,
    vanInstall: session.vanInstall,
    trackingEnabled: session.locationTrackingAllowed && session.remoteTrackingEnabled,
    backgroundSyncRequestId,
    heartbeatSource,
  });
  let appliedTrackingEnabled = session.remoteTrackingEnabled;
  let locationTrackingAllowed = session.locationTrackingAllowed;

  await applyBackgroundLocationPolicy(
    heartbeat.backgroundLocationPolicy?.pausesUpdatesAutomatically,
    false,
  );

  const serverAllowsTracking = heartbeat.locationTrackingPolicy?.enabled;
  const commandedTrackingEnabled = heartbeat.trackingCommand?.value;
  const resolvedTracking = resolveHeartbeatTrackingState({
    currentAllowed: session.locationTrackingAllowed,
    currentTrackingEnabled: session.remoteTrackingEnabled,
    serverAllowsTracking,
    commandedTrackingEnabled,
  });
  locationTrackingAllowed = resolvedTracking.locationTrackingAllowed;
  appliedTrackingEnabled = resolvedTracking.remoteTrackingEnabled;
  if (typeof serverAllowsTracking === "boolean" || typeof commandedTrackingEnabled === "boolean") {
    await setLocationTrackingPolicy(locationTrackingAllowed, appliedTrackingEnabled);
  }
  if (
    !locationTrackingAllowed
    || appliedTrackingEnabled !== session.remoteTrackingEnabled
  ) {
    await syncBackgroundLocationReporting({
      reportingVan: session.reportingVan,
      vanId: session.vanId,
      trackingEnabled: appliedTrackingEnabled,
      requestPermissions: false,
    });
  }
  if (
    locationTrackingAllowed
    && typeof commandedTrackingEnabled === "boolean"
    && appliedTrackingEnabled !== session.remoteTrackingEnabled
  ) {
    // The first heartbeat delivers Command's desired state. Report the value
    // after applying it so the Durable Object can resolve the command while
    // the app remains backgrounded; otherwise Admin stays on "pending" until
    // the foreground provider runs again.
    await sendHeartbeat({
      location: null,
      vanId: session.vanId,
      routeId: session.routeId,
      vanInstall: session.vanInstall,
      trackingEnabled: appliedTrackingEnabled,
      backgroundSyncRequestId,
      heartbeatSource,
    });
  }

  if (heartbeat.adminAction) {
    const action = heartbeat.adminAction;
    if (action.type === "reset-van") {
      await clearSession();
      await syncBackgroundLocationReporting({
        reportingVan: false,
        vanId: null,
        trackingEnabled: false,
        requestPermissions: false,
      });
      await sendHeartbeat({
        location: null,
        vanId: null,
        routeId: null,
        vanInstall: session.vanInstall,
        trackingEnabled: false,
        adminActionAck: action.id,
        backgroundSyncRequestId,
        heartbeatSource,
      });
      await syncBackgroundHeartbeatRegistration(false);
      return "synced";
    }
    if (!action.routeId) throw new Error("Background route change did not include a route.");
    await setSessionRoute(action.routeId);
    await sendHeartbeat({
      location: null,
      vanId: session.vanId,
      routeId: action.routeId,
      vanInstall: session.vanInstall,
      trackingEnabled: appliedTrackingEnabled,
      adminActionAck: action.id,
      backgroundSyncRequestId,
      heartbeatSource,
    });
  }

  let messageCount = 0;
  try {
    const afterSeq = await getLastServerSeq(session.vanId);
    const messages = await fetchVanMessages(session.vanId, afterSeq);
    messageCount = messages.length;
    if (messages.length) await upsertServerMessages(session.vanId, messages);
  } catch (error) {
    // A preview may deliberately disable messaging; the heartbeat must still
    // refresh Last seen in that deployment. Network failures remain fatal so
    // the OS can retry the task later.
    if (!isUnavailableError(error)) throw error;
    addBreadcrumb("background message sync unavailable", { vanId: session.vanId });
  }

  addBreadcrumb("background command sync ok", {
    vanId: session.vanId,
    messageCount,
    trackingEnabled: appliedTrackingEnabled,
    locationTrackingAllowed,
  });
  return "synced";
}

if (!TaskManager.isTaskDefined(BACKGROUND_HEARTBEAT_TASK)) {
  TaskManager.defineTask(BACKGROUND_HEARTBEAT_TASK, async ({ executionInfo }) => {
    // Use the task manager's execution state rather than React Native's global
    // AppState. A headless runtime can initialize AppState as "active" even
    // though the OS is delivering this task in the background.
    if (executionInfo.appState === "active") return BackgroundTask.BackgroundTaskResult.Success;
    const startedAt = Date.now();
    try {
      await syncBackgroundCommandState({ heartbeatSource: "scheduled-task" });
      metricCount("road_crew.background_sync", 1, { outcome: "success", source: "scheduled-task" });
      metricDistribution("road_crew.background_sync_latency", Date.now() - startedAt, {
        unit: "millisecond",
        source: "scheduled-task",
      });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      metricCount("road_crew.background_sync", 1, { outcome: "error", source: "scheduled-task" });
      metricDistribution("road_crew.background_sync_latency", Date.now() - startedAt, {
        unit: "millisecond",
        source: "scheduled-task",
      });
      captureError(error, {
        tags: { source: "background_command_sync" },
        extra: { error: errorMessage(error) },
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function syncBackgroundHeartbeatRegistration(enabled: boolean): Promise<void> {
  if (Platform.OS === "web") return;

  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_HEARTBEAT_TASK);
  if (enabled && !registered) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_HEARTBEAT_TASK, {
      minimumInterval: BACKGROUND_HEARTBEAT_MIN_INTERVAL_MINUTES,
    });
    addBreadcrumb("background command sync registered", {
      minimumIntervalMinutes: BACKGROUND_HEARTBEAT_MIN_INTERVAL_MINUTES,
    });
  } else if (!enabled && registered) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_HEARTBEAT_TASK);
    addBreadcrumb("background command sync unregistered");
  }
}
