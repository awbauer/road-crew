import type { ClientMessage, ServerMessage } from "@road-crew/contracts";
import { conversationIdForVan } from "@road-crew/contracts";
import { getDb } from "@/db/database";
import { highestServerSeq, unreadCount } from "@/sync/merge";
import { newClientMessageId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * Persistence + outbox queue for chat. All reads/writes go through SQLite so the
 * conversation survives app restarts and offline periods. The "outbox" is just
 * the set of rows whose status is queued/sending/failed (no serverSeq yet).
 */

interface MessageRow {
  clientMessageId: string;
  id: string | null;
  conversationId: string;
  vanId: string;
  senderType: string;
  senderId: string;
  body: string;
  scope: string;
  status: string;
  createdAtClient: string;
  createdAtServer: string | null;
  serverSeq: number | null;
  error: string | null;
}

function rowToMessage(row: MessageRow): ClientMessage {
  return {
    id: row.id || row.clientMessageId,
    clientMessageId: row.clientMessageId,
    conversationId: row.conversationId,
    vanId: row.vanId,
    senderType: row.senderType as ClientMessage["senderType"],
    senderId: row.senderId,
    body: row.body,
    scope: row.scope,
    status: row.status as ClientMessage["status"],
    createdAtClient: row.createdAtClient,
    createdAtServer: row.createdAtServer,
    serverSeq: row.serverSeq,
    error: row.error,
  };
}

/** All messages for a van, ordered oldest → newest (confirmed first by seq). */
export async function getConversation(vanId: string): Promise<ClientMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT * FROM messages WHERE vanId = ?
     ORDER BY (serverSeq IS NULL), serverSeq ASC, createdAtClient ASC`,
    [vanId],
  );
  return rows.map(rowToMessage);
}

/** Highest serverSeq we've persisted for a van (cursor for incremental sync). */
export async function getLastServerSeq(vanId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ lastServerSeq: number }>(
    "SELECT lastServerSeq FROM conversation_meta WHERE vanId = ?",
    [vanId],
  );
  return row?.lastServerSeq ?? 0;
}

async function bumpMeta(vanId: string, lastServerSeq: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO conversation_meta (vanId, lastServerSeq, readSeq, updatedAt)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(vanId) DO UPDATE SET
       lastServerSeq = MAX(conversation_meta.lastServerSeq, excluded.lastServerSeq),
       updatedAt = excluded.updatedAt`,
    [vanId, lastServerSeq, nowIso()],
  );
}

/**
 * Upserts server-confirmed messages. Confirmed rows are keyed by
 * clientMessageId so a previously-queued outbound message collapses onto its
 * server echo (clearing its local status/error).
 */
export async function upsertServerMessages(
  vanId: string,
  messages: ServerMessage[],
): Promise<void> {
  if (!messages.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const m of messages) {
      await db.runAsync(
        `INSERT INTO messages
           (clientMessageId, id, conversationId, vanId, senderType, senderId, body, scope, status, createdAtClient, createdAtServer, serverSeq, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(clientMessageId) DO UPDATE SET
           id = excluded.id,
           senderType = excluded.senderType,
           senderId = excluded.senderId,
           body = excluded.body,
           scope = excluded.scope,
           status = excluded.status,
           createdAtServer = excluded.createdAtServer,
           serverSeq = excluded.serverSeq,
           error = NULL`,
        [
          m.clientMessageId,
          m.id,
          m.conversationId || conversationIdForVan(vanId),
          vanId,
          m.senderType,
          m.senderId,
          m.body,
          m.scope || "van",
          m.status || "sent",
          m.createdAtClient,
          m.createdAtServer,
          m.serverSeq,
        ],
      );
    }
  });
  await bumpMeta(vanId, highestServerSeq(messages));
}

/**
 * Enqueues an outbound van message into the outbox. Returns the local row so the
 * UI can render it immediately (optimistic send). The clientMessageId is the
 * idempotency key reused across retries.
 */
export async function enqueueOutbound(
  vanId: string,
  body: string,
  online: boolean,
): Promise<ClientMessage> {
  const db = await getDb();
  const message: ClientMessage = {
    clientMessageId: newClientMessageId("van"),
    id: "",
    conversationId: conversationIdForVan(vanId),
    vanId,
    senderType: "van",
    senderId: vanId,
    body: body.trim(),
    scope: "van",
    status: online ? "sending" : "queued",
    createdAtClient: nowIso(),
    createdAtServer: null,
    serverSeq: null,
    error: null,
  };
  await db.runAsync(
    `INSERT INTO messages
       (clientMessageId, id, conversationId, vanId, senderType, senderId, body, scope, status, createdAtClient, createdAtServer, serverSeq, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    [
      message.clientMessageId,
      message.clientMessageId,
      message.conversationId,
      vanId,
      "van",
      vanId,
      message.body,
      "van",
      message.status,
      message.createdAtClient,
    ],
  );
  return message;
}

/** Outbound messages for a van still awaiting confirmation. */
export async function getOutbox(vanId: string): Promise<ClientMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT * FROM messages
     WHERE vanId = ? AND serverSeq IS NULL AND status IN ('queued', 'sending', 'failed')
     ORDER BY createdAtClient ASC`,
    [vanId],
  );
  return rows.map(rowToMessage);
}

export async function markOutboxStatus(
  clientMessageId: string,
  status: "queued" | "sending" | "failed",
  error: string | null = null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE messages SET status = ?, error = ? WHERE clientMessageId = ?", [
    status,
    error,
    clientMessageId,
  ]);
}

/** Re-queues every failed outbound message for a van (manual retry). */
export async function requeueFailed(vanId: string): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    "UPDATE messages SET status = 'queued', error = NULL WHERE vanId = ? AND status = 'failed'",
    [vanId],
  );
  return result.changes ?? 0;
}

/** Marks inbound (command) messages up to the latest seq as read. */
export async function markRead(vanId: string): Promise<void> {
  const db = await getDb();
  const lastServerSeq = await getLastServerSeq(vanId);
  await db.runAsync(
    `INSERT INTO conversation_meta (vanId, lastServerSeq, readSeq, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(vanId) DO UPDATE SET
       readSeq = MAX(conversation_meta.readSeq, excluded.readSeq),
       updatedAt = excluded.updatedAt`,
    [vanId, lastServerSeq, lastServerSeq, nowIso()],
  );
}

export async function getReadSeq(vanId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ readSeq: number }>(
    "SELECT readSeq FROM conversation_meta WHERE vanId = ?",
    [vanId],
  );
  return row?.readSeq ?? 0;
}

/** Unread inbound count for a van, used for badges. */
export async function getUnreadCount(vanId: string): Promise<number> {
  const messages = await getConversation(vanId);
  return unreadCount(messages, await getReadSeq(vanId));
}
