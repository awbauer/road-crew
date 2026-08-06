import { Platform, Share } from "react-native";
import { APP_CONFIG } from "@road-crew/config";
import type { PushRegistrationDiagnostics } from "@/push/diagnostics.types";
import type { BackgroundNotificationEvent } from "@/push/backgroundNotification";

export interface DiagnosticsFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  ts: number;
}

export interface DiagnosticsInput {
  deviceId: string;
  platform: string;
  runtimeOrigin: string | null;
  apiBaseUrl: string;
  heartbeatEndpoint: string;
  locationsEndpoint: string;
  buildVanInstall: boolean;
  vanId: string | null;
  vanInstall: boolean;
  vanInstallConfigured: boolean;
  vanInstallSkipped: boolean;
  reportingVan: boolean;
  /**
   * Whether background location is allowed to run. Without it an export can
   * only imply tracking state from the side effects it has on the fields
   * below, which is a slow way to answer the first question worth asking.
   */
  remoteTrackingEnabled: boolean;
  /** Worker-wide policy persisted from the latest successful heartbeat. */
  locationTrackingAllowed: boolean;
  locationReporting: boolean;
  locationReportStatus: "idle" | "ok" | "failed";
  locationLastAttemptAt: number | null;
  locationLastSuccessAt: number | null;
  locationLastError: string | null;
  online: boolean;
  gpsError: string | null;
  routeId: string | null;
  routeName: string | null;
  dataGeneratedAtMs: number | null;
  validationIssues: string[];
  resetAt: number | null;
  mapProvider: string;
  navProvider: string;
  driverMode: boolean;
  fix: DiagnosticsFix | null;
  nearest: {
    previous: { seq: number; distanceM: number };
    next: { seq: number; distanceM: number };
  } | null;
  push: PushRegistrationDiagnostics;
  /**
   * The background notification task's own log, written before any network
   * call. It is the only evidence of a wake on a device that had no background
   * connectivity, and the only place an unrecognized payload shows up locally.
   */
  backgroundNotificationEvents: BackgroundNotificationEvent[];
}

function isoOrNull(value: number | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function buildDiagnostics(input: DiagnosticsInput) {
  return {
    exportedAt: new Date().toISOString(),
    appVersion: APP_CONFIG.appVersion,
    buildNumber: APP_CONFIG.buildNumber,
    platform: input.platform,
    runtimeOrigin: input.runtimeOrigin,
    apiBaseUrl: input.apiBaseUrl,
    heartbeatEndpoint: input.heartbeatEndpoint,
    locationsEndpoint: input.locationsEndpoint,
    deviceId: input.deviceId,
    buildVanInstall: input.buildVanInstall,
    vanId: input.vanId,
    vanInstall: input.vanInstall,
    vanInstallConfigured: input.vanInstallConfigured,
    vanInstallSkipped: input.vanInstallSkipped,
    reportingVan: input.reportingVan,
    remoteTrackingEnabled: input.remoteTrackingEnabled,
    locationTrackingAllowed: input.locationTrackingAllowed,
    locationReporting: input.locationReporting,
    locationReportStatus: input.locationReportStatus,
    locationLastAttemptAt: isoOrNull(input.locationLastAttemptAt),
    locationLastSuccessAt: isoOrNull(input.locationLastSuccessAt),
    locationLastError: input.locationLastError,
    routeId: input.routeId,
    routeName: input.routeName,
    dataGeneratedAt: isoOrNull(input.dataGeneratedAtMs),
    validationIssues: input.validationIssues,
    resetAt: isoOrNull(input.resetAt),
    online: input.online,
    gpsError: input.gpsError,
    mapProvider: input.mapProvider,
    navProvider: input.navProvider,
    driverMode: input.driverMode,
    gps: input.fix
      ? {
          ageSeconds: Math.round((Date.now() - input.fix.ts) / 1000),
          accuracy: input.fix.accuracy,
          speed: input.fix.speed,
          heading: input.fix.heading,
          lat: input.fix.lat,
          lng: input.fix.lng,
        }
      : null,
    nearestSequences: input.nearest,
    push: input.push,
    backgroundNotificationEvents: input.backgroundNotificationEvents.map((entry) => ({
      ...entry,
      at: new Date(entry.ts).toISOString(),
    })),
  };
}

export async function exportDiagnostics(input: DiagnosticsInput): Promise<void> {
  const json = JSON.stringify(buildDiagnostics(input), null, 2);
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rc-van-guide-diagnostics-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ message: json, title: "Road Crew diagnostics" });
}
