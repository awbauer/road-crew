import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage } from "@road-crew/contracts";
import {
  enqueueOutbound,
  getConversation,
  markRead,
  requeueFailed,
} from "@/db/messageRepository";
import { captureError } from "@/monitoring";
import { SyncEngine } from "@/sync/SyncEngine";
import { isOnline } from "@/sync/network";
import { CONFIG } from "@/config";

interface UseConversationResult {
  messages: ClientMessage[];
  available: boolean;
  loading: boolean;
  send: (body: string) => Promise<void>;
  retryFailed: () => Promise<void>;
  markConversationRead: () => Promise<void>;
}

/**
 * Binds a van conversation to the UI: hydrates from SQLite, runs a SyncEngine
 * for live updates + outbox flushing, and exposes optimistic send/retry. The
 * engine is recreated whenever the active van changes.
 */
export function useConversation(vanId: string | null): UseConversationResult {
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [available, setAvailable] = useState(CONFIG.vanInstallEnabled);
  const [loading, setLoading] = useState(true);
  const engineRef = useRef<SyncEngine | null>(null);

  const refresh = useCallback(async () => {
    if (!vanId) {
      setMessages([]);
      return;
    }
    try {
      setMessages(await getConversation(vanId));
    } catch (error) {
      captureError(error, { tags: { source: "conversation_refresh" }, extra: { vanId } });
    }
  }, [vanId]);

  useEffect(() => {
    if (!vanId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);

    const engine = SyncEngine.for(vanId);
    engineRef.current = engine;

    const unsubChange = engine.onChange(() => {
      if (active) void refresh();
    });
    const unsubAvail = engine.onAvailabilityChange((next) => {
      if (active) setAvailable(next);
    });

    // Hydrate from disk first (instant, offline), then start live sync.
    getConversation(vanId)
      .then((initial) => {
        if (!active) return;
        setMessages(initial);
        setLoading(false);
        engine.start();
      })
      .catch((error) => {
        if (!active) return;
        setLoading(false);
        captureError(error, { tags: { source: "conversation_hydrate" }, extra: { vanId } });
      });

    return () => {
      active = false;
      unsubChange();
      unsubAvail();
      engine.stop();
      engineRef.current = null;
    };
  }, [vanId, refresh]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!vanId || !trimmed) return;
      try {
        const online = await isOnline();
        await enqueueOutbound(vanId, trimmed, online);
        await refresh();
        await engineRef.current?.flushOutbox();
      } catch (error) {
        captureError(error, {
          tags: { source: "conversation_send" },
          extra: { vanId, bodyLength: trimmed.length },
        });
        throw error;
      }
    },
    [vanId, refresh],
  );

  const retryFailed = useCallback(async () => {
    if (!vanId) return;
    try {
      await requeueFailed(vanId);
      await refresh();
      await engineRef.current?.flushOutbox();
    } catch (error) {
      captureError(error, { tags: { source: "conversation_retry_failed" }, extra: { vanId } });
      throw error;
    }
  }, [vanId, refresh]);

  const markConversationRead = useCallback(async () => {
    if (!vanId) return;
    try {
      await markRead(vanId);
    } catch (error) {
      captureError(error, { tags: { source: "conversation_mark_read" }, extra: { vanId } });
      throw error;
    }
  }, [vanId]);

  return { messages, available, loading, send, retryFailed, markConversationRead };
}
