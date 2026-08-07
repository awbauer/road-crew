import { AppState, type AppStateStatus } from "react-native";
import { CONFIG } from "@/config";
import { isUnavailableError } from "@/api/client";
import { fetchVanMessages, postVanMessage } from "@/api/messages";
import {
  getLastServerSeq,
  getOutbox,
  markOutboxStatus,
  upsertServerMessages,
} from "@/db/messageRepository";
import { errorMessage, isLikelyTransientError } from "@/lib/errors";
import { addBreadcrumb, captureError } from "@/monitoring";
import { openMessageStream, type MessageStreamHandle } from "@/sync/messageStream";
import { isOnline, onConnectivityChange } from "@/sync/network";
import { outboxFailureStatus } from "@/sync/outboxPolicy";

type ChangeListener = () => void;
type AvailabilityListener = (available: boolean) => void;

function reportSyncIssue(
  source: string,
  error: unknown,
  extra: Record<string, unknown>,
): void {
  if (isLikelyTransientError(error)) {
    addBreadcrumb(`${source} transient failure`, {
      ...extra,
      error: errorMessage(error),
    });
    return;
  }
  captureError(error, {
    tags: { source },
    extra,
  });
}

/**
 * Drives one van conversation: flushes the outbox, pulls inbound history, holds
 * a live SSE stream open, and reconnects across app foreground/background and
 * connectivity changes. Falls back to polling after repeated stream errors.
 *
 * One engine is active at a time (the driver's own van). Construct via
 * {@link SyncEngine.for} and always {@link stop} the previous one first.
 */
export class SyncEngine {
  private vanId: string;
  private stream: MessageStreamHandle | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private netSub: (() => void) | null = null;
  private sseErrors = 0;
  private running = false;
  private connecting = false;
  private flushing = false;
  private available = true;
  private changeListeners = new Set<ChangeListener>();
  private availabilityListeners = new Set<AvailabilityListener>();

  private constructor(vanId: string) {
    this.vanId = vanId;
  }

  static for(vanId: string): SyncEngine {
    return new SyncEngine(vanId);
  }

  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onAvailabilityChange(listener: AvailabilityListener): () => void {
    this.availabilityListeners.add(listener);
    return () => this.availabilityListeners.delete(listener);
  }

  isAvailable(): boolean {
    return this.available;
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  private setAvailable(next: boolean): void {
    if (this.available === next) return;
    this.available = next;
    for (const listener of this.availabilityListeners) listener(next);
    if (!next) this.teardownTransport();
  }

  // ---------- public lifecycle ----------

  start(): void {
    if (!CONFIG.vanInstallEnabled) {
      this.setAvailable(false);
      return;
    }
    if (this.running) {
      // Already running — just reconnect the transport (e.g. on foreground).
      void this.connect();
      void this.flushOutbox();
      return;
    }
    this.running = true;
    this.appStateSub = AppState.addEventListener("change", this.handleAppState);
    this.netSub = onConnectivityChange((online) => {
      if (online) {
        addBreadcrumb("sync connectivity restored", { vanId: this.vanId });
        void this.connect();
        void this.flushOutbox();
      }
    });
    addBreadcrumb("sync engine started", { vanId: this.vanId });
    void this.connect();
    void this.flushOutbox();
  }

  stop(): void {
    this.running = false;
    addBreadcrumb("sync engine stopped", { vanId: this.vanId });
    this.teardownTransport();
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.netSub?.();
    this.netSub = null;
  }

  private teardownTransport(): void {
    this.closeStream();
    this.stopPolling();
  }

  private handleAppState = (state: AppStateStatus): void => {
    if (!this.running) return;
    if (state === "active") {
      // Foreground: reconnect and reconcile immediately.
      addBreadcrumb("sync app foregrounded", { vanId: this.vanId });
      void this.reconcileForeground();
    } else {
      // Background: drop the live stream so we don't hold a dead socket.
      addBreadcrumb("sync app backgrounded", { vanId: this.vanId, state });
      this.teardownTransport();
    }
  };

  private async reconcileForeground(): Promise<void> {
    await this.pullOnce();
    await this.connect();
    await this.flushOutbox();
    // The headless background task may have advanced SQLite while this engine
    // was suspended. Refresh mounted conversation screens even when the pull
    // had nothing new to fetch because the local cursor was already current.
    this.emitChange();
  }

  // ---------- transport (SSE preferred, polling fallback) ----------

  private async connect(): Promise<void> {
    if (!this.running || !this.available || this.connecting) return;
    this.connecting = true;
    this.closeStream();
    this.stopPolling();
    try {
      if (!(await isOnline()) || !this.running || !this.available) return;
      const afterSeq = await getLastServerSeq(this.vanId);
      this.sseErrors = 0;
      const stream = await openMessageStream(this.vanId, afterSeq, {
        onMessage: (message) => {
          this.sseErrors = 0;
          void upsertServerMessages(this.vanId, [message])
            .then(() => this.emitChange())
            .catch((error) => {
              reportSyncIssue("sync_stream_persist", error, {
                vanId: this.vanId,
                serverSeq: message.serverSeq ?? null,
              });
            });
        },
        onError: () => {
          this.sseErrors += 1;
          addBreadcrumb("sync stream error", {
            vanId: this.vanId,
            sseErrors: this.sseErrors,
          });
          if (this.sseErrors >= CONFIG.sseErrorThreshold) {
            addBreadcrumb("sync stream falling back to polling", {
              vanId: this.vanId,
              sseErrors: this.sseErrors,
            });
            this.closeStream();
            this.startPolling();
          }
        },
      });
      if (!this.running || !this.available) {
        stream.close();
        return;
      }
      this.stream = stream;
      addBreadcrumb("sync stream connected", { vanId: this.vanId, afterSeq });
    } catch (error) {
      if (!this.running) return;
      if (isUnavailableError(error)) {
        addBreadcrumb("sync stream unavailable", { vanId: this.vanId });
        this.setAvailable(false);
        return;
      }
      reportSyncIssue("sync_connect", error, { vanId: this.vanId });
      this.startPolling();
    } finally {
      this.connecting = false;
    }
  }

  private closeStream(): void {
    this.stream?.close();
    this.stream = null;
  }

  private startPolling(): void {
    this.stopPolling();
    const tick = () => {
      void this.pullOnce();
      void this.flushOutbox();
    };
    tick();
    this.pollTimer = setInterval(tick, CONFIG.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ---------- sync operations ----------

  /** Pulls inbound messages newer than our cursor and persists them. */
  async pullOnce(): Promise<void> {
    if (!this.available) return;
    if (!(await isOnline())) return;
    try {
      const afterSeq = await getLastServerSeq(this.vanId);
      const messages = await fetchVanMessages(this.vanId, afterSeq);
      if (messages.length) {
        await upsertServerMessages(this.vanId, messages);
        this.emitChange();
      }
    } catch (error) {
      if (isUnavailableError(error)) {
        addBreadcrumb("sync pull unavailable", { vanId: this.vanId });
        this.setAvailable(false);
        return;
      }
      reportSyncIssue("sync_pull", error, { vanId: this.vanId });
      // Otherwise offline/transient — keep local state, next tick retries.
    }
  }

  /** Sends every queued/failed outbound message in order (idempotent on id). */
  async flushOutbox(): Promise<void> {
    if (!this.available || this.flushing) return;
    this.flushing = true;
    try {
      const online = await isOnline();
      if (!online) return;
      const outbox = await getOutbox(this.vanId);
      for (const item of outbox) {
        await markOutboxStatus(item.clientMessageId, "sending");
        this.emitChange();
        try {
          const confirmed = await postVanMessage(this.vanId, {
            clientMessageId: item.clientMessageId,
            body: item.body,
            createdAtClient: item.createdAtClient,
          });
          await upsertServerMessages(this.vanId, [confirmed]);
          this.emitChange();
        } catch (error) {
          if (isUnavailableError(error)) {
            addBreadcrumb("sync send unavailable", {
              vanId: this.vanId,
              clientMessageId: item.clientMessageId,
            });
            this.setAvailable(false);
            return;
          }
          const stillOnline = await isOnline();
          const nextStatus = outboxFailureStatus(error, stillOnline);
          const message = error instanceof Error ? error.message : "Message send failed.";
          await markOutboxStatus(item.clientMessageId, nextStatus, nextStatus === "failed" ? message : null);
          this.emitChange();
          reportSyncIssue("sync_send", error, {
            vanId: this.vanId,
            clientMessageId: item.clientMessageId,
            online: stillOnline,
            nextStatus,
          });
          if (nextStatus === "queued") break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
