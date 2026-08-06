import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { sanitizeFix } from "@road-crew/core";
import type { PostLocationBody } from "@road-crew/contracts";
import { isUnavailableError } from "@/api/client";
import { sendHeartbeat } from "@/api/heartbeat";
import { fetchVanMessages } from "@/api/messages";
import { clearSession, loadSession, setLocationTrackingPolicy, setSessionRoute } from "@/auth/session";
import { CONFIG } from "@/config";
import { getLastServerSeq, upsertServerMessages } from "@/db/messageRepository";
import { getDeviceId } from "@/device/deviceId";
import { isFixReportable } from "@/field/locationReporter.js";
import { resolveHeartbeatTrackingState } from "@/field/trackingPolicy";
import { errorMessage } from "@/lib/errors";
import { addBreadcrumb, captureError, metricCount } from "@/monitoring";

export const BACKGROUND_LOCATION_TASK = "rc-background-location";

const BACKGROUND_REPORT_INTERVAL_MS = 45_000;
const BACKGROUND_LAST_REPORT_KEY = "rc.location.backgroundLastReportAt";
const BACKGROUND_PAUSE_UPDATES_KEY = "rc.location.backgroundPausesUpdatesAutomatically";
let backgroundReportInFlight = false;

type BackgroundLocationData = {
  locations?: Location.LocationObject[];
};

function toFix(location: Location.LocationObject) {
  return sanitizeFix({
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy,
    heading: location.coords.heading,
    speed: location.coords.speed,
    ts: location.timestamp,
  });
}

async function pausesBackgroundUpdatesAutomatically(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BACKGROUND_PAUSE_UPDATES_KEY)) === "true";
  } catch {
    // Preserve the original reliability-first behavior if local storage fails.
    return false;
  }
}

async function storeBackgroundPausePolicy(pausesUpdatesAutomatically: boolean): Promise<boolean> {
  try {
    await AsyncStorage.setItem(
      BACKGROUND_PAUSE_UPDATES_KEY,
      String(pausesUpdatesAutomatically),
    );
    return true;
  } catch {
    addBreadcrumb("background location policy persistence failed");
    return false;
  }
}

/**
 * Claim the report slot before making a network request. iOS can invoke
 * several location callbacks in the same JS runtime at once; writing only
 * after the request lets every callback pass the old timestamp.
 */
async function beginBackgroundReport(): Promise<boolean> {
  if (backgroundReportInFlight) return false;
  backgroundReportInFlight = true;
  try {
    const lastReportAt = Number(await AsyncStorage.getItem(BACKGROUND_LAST_REPORT_KEY));
    if (Number.isFinite(lastReportAt) && Date.now() - lastReportAt < BACKGROUND_REPORT_INTERVAL_MS) {
      backgroundReportInFlight = false;
      return false;
    }
    await AsyncStorage.setItem(BACKGROUND_LAST_REPORT_KEY, String(Date.now()));
    return true;
  } catch {
    // Preserve reporting if storage is unavailable; the in-memory lock still
    // prevents duplicate callbacks in this JS runtime.
    return true;
  }
}

async function pullBackgroundMessages(vanId: string): Promise<void> {
  try {
    const messages = await fetchVanMessages(vanId, await getLastServerSeq(vanId));
    if (messages.length) await upsertServerMessages(vanId, messages);
  } catch (error) {
    // A deployment may intentionally disable messaging; that must not turn a
    // successful location heartbeat into a failed background task.
    if (!isUnavailableError(error)) throw error;
    addBreadcrumb("background message sync unavailable", { vanId });
  }
}

async function reportBackgroundLocation(locations: Location.LocationObject[]): Promise<void> {
  // A foreground heartbeat owns reporting while the app is visible. This task
  // receives the same native updates, so the task executor filters foreground
  // callbacks before reaching here. Do not inspect AppState in this function:
  // headless React Native runtimes can initialize AppState as "active" while
  // servicing a native background task, which would suppress every report.
  const session = await loadSession();
  if (!CONFIG.vanInstallEnabled || !session.reportingVan || !session.vanId) return;
  // A callback can already be queued when tracking is turned off. Stop this
  // location-driven path; the separate background heartbeat task still polls
  // Command without creating location-task heartbeats without a location.
  if (!session.locationTrackingAllowed || !session.remoteTrackingEnabled) {
    await syncBackgroundLocationReporting({
      reportingVan: session.reportingVan,
      vanId: session.vanId,
      trackingEnabled: false,
      requestPermissions: false,
    });
    return;
  }
  if (!(await beginBackgroundReport())) return;

  try {

  const fix = locations.length ? toFix(locations[locations.length - 1]) : null;
  const shouldSendLocation = Boolean(fix && isFixReportable(fix));

  const location: PostLocationBody | null = shouldSendLocation && fix
    ? {
        vanId: session.vanId,
        deviceId: await getDeviceId(),
        lat: fix.lat,
        lng: fix.lng,
        ts: fix.ts,
        accuracy: fix.accuracy,
        heading: fix.heading,
        speed: fix.speed,
      }
    : null;
  const heartbeat = await sendHeartbeat({
    location,
    vanId: session.vanId,
    routeId: session.routeId,
    vanInstall: session.vanInstall,
    trackingEnabled: session.locationTrackingAllowed && session.remoteTrackingEnabled,
    heartbeatSource: "location-task",
  });
  let appliedTrackingEnabled: boolean = session.remoteTrackingEnabled;
  let locationTrackingAllowed: boolean = session.locationTrackingAllowed;
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
      heartbeatSource: "location-task",
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
        heartbeatSource: "location-task",
      });
      return;
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
      heartbeatSource: "location-task",
    });
  }

  await pullBackgroundMessages(session.vanId);
  if (location && locationTrackingAllowed && !heartbeat.locationReport?.ok) {
    throw new Error(heartbeat.locationReport?.error || "Background location report was rejected.");
  }
  metricCount("road_crew.location_task", 1, {
    outcome: "success",
    locationReported: String(Boolean(location && locationTrackingAllowed)),
  });
  addBreadcrumb("background heartbeat reported", {
    vanId: session.vanId,
    reportedLocation: Boolean(location && locationTrackingAllowed),
    locationTrackingAllowed,
    locationTs: location?.ts ?? null,
  });
  } finally {
    backgroundReportInFlight = false;
  }
}

// This module is imported from the app entry point so it is evaluated when iOS
// or Android launches the JS runtime solely to deliver a background location.
if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask<BackgroundLocationData>(BACKGROUND_LOCATION_TASK, async ({ data, error, executionInfo }) => {
    if (error) {
      metricCount("road_crew.location_task", 1, { outcome: "task_error" });
      captureError(new Error(error.message), {
        tags: { source: "background_location_task" },
        extra: { code: error.code },
      });
      return;
    }
    // Use the task manager's execution state rather than React Native's global
    // AppState, which is not reliable in a headless launch.
    if (executionInfo.appState === "active") return;
    try {
      await reportBackgroundLocation(data.locations ?? []);
    } catch (taskError) {
      metricCount("road_crew.location_task", 1, { outcome: "error" });
      captureError(taskError, {
        tags: { source: "background_location_report" },
        extra: { error: errorMessage(taskError) },
      });
    }
  });
}

export async function syncBackgroundLocationReporting({
  reportingVan,
  vanId,
  trackingEnabled = true,
  requestPermissions = true,
}: {
  reportingVan: boolean;
  vanId: string | null;
  /** Command-controlled flag from the heartbeat response; stops the native watcher when false. */
  trackingEnabled?: boolean;
  /** Never prompt from a headless iOS background location callback. */
  requestPermissions?: boolean;
}): Promise<void> {
  const taskAvailable = await TaskManager.isAvailableAsync();
  if (!taskAvailable) {
    addBreadcrumb("background location unavailable");
    return;
  }

  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (!CONFIG.vanInstallEnabled || !reportingVan || !vanId || !trackingEnabled) {
    if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    return;
  }

  if (!(await Location.isBackgroundLocationAvailableAsync())) {
    addBreadcrumb("background location unavailable");
    return;
  }

  const foreground = requestPermissions
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    addBreadcrumb("background location foreground permission denied");
    return;
  }
  const background = requestPermissions
    ? await Location.requestBackgroundPermissionsAsync()
    : await Location.getBackgroundPermissionsAsync();
  if (background.status !== "granted") {
    addBreadcrumb("background location permission denied");
    return;
  }

  if (!started) {
    const pausesUpdatesAutomatically = await pausesBackgroundUpdatesAutomatically();
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      // Expo Location's timeInterval is Android-only. On iOS, a 10 m
      // distanceFilter can suppress every callback while a tracked van is
      // stationary, so accept native updates and enforce the 45 s heartbeat
      // cadence by reserving a report slot instead.
      timeInterval: BACKGROUND_REPORT_INTERVAL_MS,
      distanceInterval: Platform.OS === "ios" ? 0 : 10,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Road Crew location sharing",
        notificationBody: "Your tracked van location is being shared.",
        notificationColor: "#d7261e",
        killServiceOnDestroy: false,
      },
    });
    addBreadcrumb("background location started", { vanId, pausesUpdatesAutomatically });
  }
}

/**
 * Apply the Worker-provided policy after a heartbeat. iOS does not expose the
 * options of an already-registered task, so a changed policy is applied by
 * re-registering that task with the persisted value.
 */
export async function applyBackgroundLocationPolicy(
  pausesUpdatesAutomatically: boolean | undefined,
  requestPermissions = true,
): Promise<void> {
  if (typeof pausesUpdatesAutomatically !== "boolean") return;

  const current = await pausesBackgroundUpdatesAutomatically();
  if (current === pausesUpdatesAutomatically) return;

  if (!(await storeBackgroundPausePolicy(pausesUpdatesAutomatically))) return;
  const session = await loadSession();
  if (
    !CONFIG.vanInstallEnabled
    || !session.reportingVan
    || !session.vanId
    || !session.locationTrackingAllowed
    || !session.remoteTrackingEnabled
  ) return;

  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  await syncBackgroundLocationReporting({
    reportingVan: session.reportingVan,
    vanId: session.vanId,
    trackingEnabled: session.locationTrackingAllowed && session.remoteTrackingEnabled,
    requestPermissions,
  });
  addBreadcrumb("background location policy applied", { pausesUpdatesAutomatically });
}
