import EventSource from "react-native-sse";
import { Platform } from "react-native";
import type { ServerMessage } from "@road-crew/contracts";
import { apiUrl } from "@/api/client";
import { vanStreamUrl } from "@/api/messages";
import { getCloudflareAccessHeaders } from "@/auth/cloudflareAccess";
import { CONFIG } from "@/config";
import { DEVICE_ID_HEADER, getDeviceId } from "@/device/deviceId";
import { addBreadcrumb } from "@/monitoring";

/**
 * Live SSE subscription to a van conversation. React Native has no built-in
 * EventSource, so we use `react-native-sse`. The Worker replays missed messages
 * (serverSeq > afterSeq / Last-Event-ID) on connect, then pushes new ones.
 *
 * The engine layered on top (SyncEngine) decides when to use this vs. polling.
 */

export interface MessageStreamHandlers {
  onMessage: (message: ServerMessage) => void;
  onError: () => void;
  onOpen?: () => void;
}

export interface MessageStreamHandle {
  close: () => void;
}

export async function openMessageStream(
  vanId: string,
  afterSeq: number,
  handlers: MessageStreamHandlers,
): Promise<MessageStreamHandle> {
  if (Platform.OS === "web") {
    throw new Error("Worker message streams are disabled in the web field guide.");
  }
  const url = apiUrl(vanStreamUrl(vanId, afterSeq));
  const [deviceId, accessHeaders] = await Promise.all([
    getDeviceId(),
    getCloudflareAccessHeaders(),
  ]);
  const es = new EventSource(url, {
    headers: {
      "Last-Event-ID": String(afterSeq || ""),
      [DEVICE_ID_HEADER]: deviceId,
      ...accessHeaders,
    },
    // Auto-reconnect delay. We let the library retry (each failed attempt fires
    // an `error`, which the SyncEngine counts) and only switch to manual polling
    // after the error threshold — mirroring the PWA's EventSource behavior.
    pollingInterval: CONFIG.pollIntervalMs,
  });

  es.addEventListener("open", () => handlers.onOpen?.());

  es.addEventListener("message", (event) => {
    if (!event.data) return;
    try {
      handlers.onMessage(JSON.parse(event.data) as ServerMessage);
    } catch (error) {
      addBreadcrumb("message stream payload parse failed", {
        vanId,
        afterSeq,
        error: error instanceof Error ? error.message : String(error),
      });
      // Malformed event — ignore, the next pull will reconcile.
    }
  });

  es.addEventListener("error", () => handlers.onError());

  return {
    close: () => {
      es.removeAllEventListeners();
      es.close();
    },
  };
}
