import { Platform } from "react-native";
import { APP_VERSION } from "@road-crew/config";
import { currentDeviceType } from "@/field/deviceType";
import { apiFetch } from "@/api/client";
import type { HeartbeatLocationBody, HeartbeatRequest, HeartbeatResponse } from "@road-crew/contracts";
import { CONFIG } from "@/config";
import { recordLastHeartbeatAt } from "@/update/lastHeartbeat";
import { logError, metricCount, metricDistribution } from "@/monitoring";

/** Syncs app metadata and notifications, optionally reporting this van's fix. */
export async function sendHeartbeat({
  location,
  vanId = null,
  routeId = null,
  vanInstall,
  trackingEnabled,
  adminActionAck = null,
  backgroundSyncRequestId = null,
  heartbeatSource = null,
  heartbeatReason = null,
}: {
  location: HeartbeatLocationBody | null;
  vanId?: string | null;
  routeId?: string | null;
  vanInstall: boolean;
  /** Whether background tracking is applied; drivers and Command converge through this report. */
  trackingEnabled?: boolean;
  adminActionAck?: string | null;
  backgroundSyncRequestId?: string | null;
  heartbeatSource?: "foreground" | "location-task" | "scheduled-task" | "silent-push" | null;
  /** The trigger within that path — "launch", "focus", "interval" and so on. */
  heartbeatReason?: string | null;
}): Promise<HeartbeatResponse> {
  const startedAt = Date.now();
  const source = heartbeatSource || "foreground";
  const body: HeartbeatRequest = {
    location,
    vanId,
    routeId,
    vanInstall,
    trackingEnabled,
    adminActionAck,
    backgroundSyncRequestId,
    heartbeatSource: source,
    heartbeatReason,
    appBuild: APP_VERSION.build,
    appRelease: APP_VERSION.release,
    appVersion: APP_VERSION.release,
    buildNumber: APP_VERSION.build,
    releaseVersion: APP_VERSION.release,
    platform: Platform.OS,
    deviceType: currentDeviceType(),
  };
  try {
    const response = await apiFetch<HeartbeatResponse>(CONFIG.heartbeatPath, {
      method: "POST",
      body: JSON.stringify(body),
      cache: "no-store",
      timeoutMs: CONFIG.requestTimeoutMs,
    });
    await recordLastHeartbeatAt(
      Number.isFinite(response.serverNow) && Number(response.serverNow) > 0
        ? Number(response.serverNow)
        : Date.now(),
    );
    const latencyMs = Date.now() - startedAt;
    metricCount("road_crew.heartbeat", 1, {
      outcome: "success",
      source,
      locationReported: String(Boolean(location)),
    });
    metricDistribution("road_crew.heartbeat_latency", latencyMs, {
      unit: "millisecond",
      source,
    });
    return response;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    logError("Road Crew heartbeat failed", { source, locationReported: String(Boolean(location)) });
    metricCount("road_crew.heartbeat", 1, { outcome: "error", source });
    metricDistribution("road_crew.heartbeat_latency", latencyMs, { unit: "millisecond", source });
    throw error;
  }
}
