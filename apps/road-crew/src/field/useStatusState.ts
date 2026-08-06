import { useEffect, useMemo, useState } from "react";
import { type ViewStyle } from "react-native";
import { colors } from "@road-crew/ui";
import { generatedAtMs, getDataWarnings, getRouteById } from "@road-crew/data";
import { validateRouteData, computeAppStatus, type AppStatus } from "@road-crew/core";
import type { Route } from "@road-crew/contracts";
import { isOnline, onConnectivityChange } from "@/sync/network";
import { useSession } from "@/auth/SessionProvider";
import { CONFIG } from "@/config";
import { useRoutes } from "./useRoutes.ts";
import { useSharedGeolocation } from "./Geolocation.tsx";
import type { Fix } from "./geolocation-types.ts";
import { useSelectedRoute } from "./RouteSelection.tsx";
import { useLocationReporter, type LocationReportStatus } from "@/update/HeartbeatProvider";
import { useNow } from "@/ui/useNow";

/** Everything the diagnostics panel and the header status pill read. */
export interface StatusState {
  nowMs: number;
  status: AppStatus;
  statusColor: string;
  online: boolean;
  fix: Fix | null;
  route: Route | null;
  updatedMs: number | null;
  validationIssues: string[];
  issues: number;
  locationReporting: boolean;
  locationReportStatus: LocationReportStatus;
  locationLastAttemptAt: number | null;
  locationLastSuccessAt: number | null;
  lastHeartbeatAt: number | null;
  locationLastError: string | null;
  vanInstall: boolean;
  gpsError: string | null;
}

export function statusColorFor(status: AppStatus): string {
  // Untracked is not a severity, so it keeps the default text colour rather
  // than borrowing green/amber/red. The pill below is what makes it stand out.
  if (status.level === "untracked") return colors.text;
  return status.level === "green" ? colors.green : status.level === "amber" ? colors.amber : colors.brandRed;
}

/**
 * Style for the "Live ›" status pill in the map/route headers. A paused van
 * install reads as its own thing rather than another severity colour: black
 * with a dashed white outline.
 */
export function statusPillStyle(status: AppStatus): ViewStyle {
  if (status.level === "untracked") {
    return { backgroundColor: "#000", borderWidth: 1, borderStyle: "dashed", borderColor: "#fff" };
  }
  return { backgroundColor: statusColorFor(status) };
}

export function useStatusState(): StatusState {
  const { data } = useRoutes();
  const { fix, error: gpsError } = useSharedGeolocation();
  const { routeId } = useSelectedRoute();
  const route = data && routeId ? (getRouteById(data, routeId) ?? null) : null;
  const [online, setOnline] = useState(true);
  const {
    reporting: locationReporting,
    reportStatus: locationReportStatus,
    lastAttemptAt: locationLastAttemptAt,
    lastSuccessAt: locationLastSuccessAt,
    lastHeartbeatAt,
    lastError: locationLastError,
  } = useLocationReporter();
  const { vanInstall, remoteTrackingEnabled } = useSession();
  const nowMs = useNow(true, 1_000);
  const trackingPaused = CONFIG.vanInstallEnabled && vanInstall && !remoteTrackingEnabled;

  const updatedMs = generatedAtMs(data);
  const validationIssues = data ? [...validateRouteData(data), ...getDataWarnings()] : [];
  const issues = validationIssues.length;

  useEffect(() => {
    isOnline().then((v) => setOnline(v));
    return onConnectivityChange(setOnline);
  }, []);

  const status: AppStatus = useMemo(
    () => computeAppStatus({
      hasFix: Boolean(fix),
      fixTs: fix?.ts ?? null,
      online,
      locationReportFailed: locationReporting && locationReportStatus === "failed",
      trackingPaused,
      dataGeneratedAtMs: updatedMs || null,
      validationIssueCount: issues,
      nowMs,
    }),
    [fix, online, locationReporting, locationReportStatus, trackingPaused, updatedMs, issues, nowMs],
  );

  return {
    nowMs,
    status,
    statusColor: statusColorFor(status),
    online,
    fix,
    route,
    updatedMs: updatedMs || null,
    validationIssues,
    issues,
    locationReporting,
    locationReportStatus,
    locationLastAttemptAt,
    locationLastSuccessAt,
    lastHeartbeatAt,
    locationLastError,
    vanInstall,
    gpsError,
  };
}
