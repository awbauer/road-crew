import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Updates from "expo-updates";
import { APP_VERSION } from "@road-crew/config";
import { fetchPublishedVersion } from "@/api/version";
import { addBreadcrumb, captureError, metricCount } from "@/monitoring";
import { errorMessage } from "@/lib/errors";
import { useNotifications } from "@/notifications/NotificationsProvider";
import { isRemoteBuildNewer } from "./versionComparison.js";
import { applyAvailableNativeUpdate, updateApp } from "./appUpdate";

const VERSION_CHECK_INTERVAL_MS = 15 * 60 * 1000;

function versionCandidate(value: string | number | null | undefined): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

/** Checks for a newer app version independently of the 30-second heartbeat.
 *
 * Native checks the embedded EAS channel/runtime via expo-updates. Web has no
 * Expo Updates equivalent, so it checks the deployed Worker `/version` endpoint.
 * A detected update is installed immediately. The reloaded app records the
 * completed update in the Notification Center. */
export function AppUpdateChecker() {
  const attemptedVersion = useRef<string | null>(null);
  const { ready } = useNotifications();

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let inFlight = false;

    const checkNative = async (reason: string) => {
      try {
        const update = await Updates.checkForUpdateAsync();
        metricCount("road_crew.update_check", 1, {
          outcome: update.isAvailable ? "available" : "current",
          platform: "native",
          reason,
        });
        addBreadcrumb("automatic app update checked", { available: update.isAvailable, reason });
        if (cancelled || !update.isAvailable) return;
        addBreadcrumb("automatic app update applying", { reason });
        await applyAvailableNativeUpdate();
      } catch (error) {
        metricCount("road_crew.update_check", 1, { outcome: "error", platform: "native", reason });
        addBreadcrumb("automatic app update failed", { error: errorMessage(error) });
        captureError(error, {
          tags: { source: "automatic_app_update" },
          extra: { reason },
        });
      }
    };

    const checkWeb = async (reason: string) => {
      try {
        const published = await fetchPublishedVersion();
        const latestBuild = versionCandidate(published.buildNumber);
        const latestRelease = versionCandidate(published.releaseVersion);
        metricCount("road_crew.update_check", 1, {
          outcome: latestBuild && isRemoteBuildNewer(APP_VERSION.build, latestBuild) ? "available" : "current",
          platform: "web",
          reason,
        });
        addBreadcrumb("app version check ok", { reason, latestBuild, latestRelease });
        if (
          cancelled
          || !latestBuild
          || attemptedVersion.current === latestBuild
          || !isRemoteBuildNewer(APP_VERSION.build, latestBuild)
        ) {
          return;
        }

        attemptedVersion.current = latestBuild;
        addBreadcrumb("automatic app update applying", { latestBuild, latestRelease, reason });
        await updateApp();
      } catch (error) {
        metricCount("road_crew.update_check", 1, { outcome: "error", platform: "web", reason });
        addBreadcrumb("app version check failed", { reason, error: errorMessage(error) });
        captureError(error, { tags: { source: "app_version_check" }, extra: { reason } });
      }
    };

    const check = async (reason: string) => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        if (Platform.OS === "web") {
          await checkWeb(reason);
        } else {
          await checkNative(reason);
        }
      } finally {
        inFlight = false;
      }
    };

    void check("launch");
    const interval = setInterval(() => {
      void check("interval");
    }, VERSION_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ready]);

  return null;
}
