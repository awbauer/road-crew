import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { syncBackgroundCommandState } from "@/sync/backgroundHeartbeat";
import type { BackgroundSyncOutcome } from "@/sync/backgroundHeartbeat";
import { reportWakeOutcome, type WakeOutcome } from "@/api/pushWake";
import { readAnySyncRequestId, readSyncRequest } from "./syncRequestPayload.js";
import { addBreadcrumb, captureError, metricCount, metricDistribution } from "@/monitoring";

export const BACKGROUND_NOTIFICATION_TASK = "rc-background-notification";
const DIAGNOSTIC_KEY = "rc.background-notification.last-events";
const MAX_DIAGNOSTIC_EVENTS = 12;

export interface BackgroundNotificationEvent {
  event: string;
  syncRequestId: string | null;
  ts: number;
}

/**
 * The last few background-task events, newest last. Written before any network
 * call, so this is the one record of a wake that survives a device with no
 * background connectivity — which is exactly when Command learns nothing.
 */
export async function readBackgroundNotificationEvents(): Promise<BackgroundNotificationEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(DIAGNOSTIC_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as BackgroundNotificationEvent[] : [];
  } catch {
    return [];
  }
}

async function recordEvent(event: string, syncRequestId: string | null = null): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DIAGNOSTIC_KEY);
    const current = raw ? JSON.parse(raw) : [];
    const events = Array.isArray(current) ? current : [];
    events.push({ event, syncRequestId, ts: Date.now() });
    await AsyncStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify(events.slice(-MAX_DIAGNOSTIC_EVENTS)));
  } catch {
    // Background diagnostics are best effort and must never block a heartbeat.
  }
}

/**
 * Diagnostics only: a wake that ran must never be downgraded to a failure just
 * because Command could not be told about it. The heartbeat itself, when there
 * was one, has already reported the real work.
 */
async function acknowledgeWake(
  syncRequestId: string | null,
  outcome: BackgroundSyncOutcome | WakeOutcome,
): Promise<void> {
  try {
    await reportWakeOutcome(syncRequestId, outcome);
  } catch (error) {
    addBreadcrumb("wake acknowledgement failed", {
      syncRequestId,
      outcome,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    BACKGROUND_NOTIFICATION_TASK,
    async ({ data, error }) => {
      const payload = readSyncRequest(data);
      await recordEvent(error ? "error" : payload ? "entered" : "ignored", payload?.syncRequestId || null);
      if (error) {
        metricCount("road_crew.background_push", 1, { outcome: "error" });
        await acknowledgeWake(readAnySyncRequestId(data), "failed");
        captureError(error, { tags: { source: "background_notification_task" } });
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
      if (!payload) {
        metricCount("road_crew.background_push", 1, { outcome: "ignored" });
        // The wake ran and was not recognized. Acknowledge it anyway — an
        // unparsed push used to return here silently, which is how a payload
        // shape change went unnoticed across the whole fleet.
        await acknowledgeWake(readAnySyncRequestId(data), "ignored");
        return Notifications.BackgroundNotificationTaskResult.NoData;
      }

      const startedAt = Date.now();
      try {
        metricCount("road_crew.background_push", 1, { outcome: "received" });
        const outcome = await syncBackgroundCommandState({
          backgroundSyncRequestId: payload.syncRequestId,
          heartbeatSource: "silent-push",
        });
        // A wake that skipped is not a success. Reporting it as one is what
        // made an accepted-but-inert push indistinguishable from a delivered
        // one, on the device metrics and in Command alike.
        metricCount("road_crew.background_sync", 1, { outcome, source: "silent-push" });
        metricDistribution("road_crew.background_sync_latency", Date.now() - startedAt, {
          unit: "millisecond",
          source: "silent-push",
        });
        await recordEvent(`sync-${outcome}`, payload.syncRequestId);
        await acknowledgeWake(payload.syncRequestId, outcome);
        return outcome === "synced"
          ? Notifications.BackgroundNotificationTaskResult.NewData
          : Notifications.BackgroundNotificationTaskResult.NoData;
      } catch (taskError) {
        metricCount("road_crew.background_sync", 1, { outcome: "error", source: "silent-push" });
        metricDistribution("road_crew.background_sync_latency", Date.now() - startedAt, {
          unit: "millisecond",
          source: "silent-push",
        });
        await recordEvent("sync-failed", payload.syncRequestId);
        await acknowledgeWake(payload.syncRequestId, "failed");
        captureError(taskError, {
          tags: { source: "background_notification_sync" },
          extra: { syncRequestId: payload.syncRequestId },
        });
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
    },
  );
}

void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch((error) => {
  addBreadcrumb("background notification task registration failed", {
    error: error instanceof Error ? error.message : String(error),
  });
});
