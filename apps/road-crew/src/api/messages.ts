import { apiFetch } from "@/api/client";
import { CONFIG } from "@/config";
import type {
  ListVanMessagesResponse,
  MessagesBootstrapResponse,
  PostVanMessageBody,
  PostVanMessageResponse,
  ServerMessage,
} from "@road-crew/contracts";

/**
 * Worker messaging endpoints (van → Command). These map 1:1 to the public API
 * implemented by the backend Worker, which is not part of this repository.
 */

export async function bootstrapMessages(vanId: string | null): Promise<MessagesBootstrapResponse> {
  return apiFetch<MessagesBootstrapResponse>(
    `${CONFIG.messagesPath}/bootstrap${vanId ? `?vanId=${encodeURIComponent(vanId)}` : ""}`,
  );
}

export async function fetchVanMessages(vanId: string, afterSeq = 0): Promise<ServerMessage[]> {
  const payload = await apiFetch<ListVanMessagesResponse>(
    `${CONFIG.messagesPath}/van/${encodeURIComponent(vanId)}?afterSeq=${encodeURIComponent(afterSeq)}`,
  );
  return Array.isArray(payload.messages) ? payload.messages : [];
}

export async function postVanMessage(
  vanId: string,
  body: PostVanMessageBody,
): Promise<ServerMessage> {
  const payload = await apiFetch<PostVanMessageResponse>(
    `${CONFIG.messagesPath}/van/${encodeURIComponent(vanId)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: CONFIG.messageTimeoutMs,
    },
  );
  return payload.message;
}

/** SSE stream URL for a van conversation (consumed by the sync engine). */
export function vanStreamUrl(vanId: string, afterSeq = 0): string {
  return `${CONFIG.messagesPath}/van/${encodeURIComponent(vanId)}/stream?afterSeq=${encodeURIComponent(
    afterSeq,
  )}`;
}
