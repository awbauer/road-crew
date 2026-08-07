/**
 * Pure message-merge helpers shared by the synchronization layer.
 *
 * Messages are deduped by `clientMessageId` (falling back to `id`) so a locally
 * queued message and its server-confirmed echo collapse into one row. Ordering
 * is by `serverSeq` when present; unconfirmed (null seq) messages sort to the
 * end by client timestamp.
 *
 * Authored as plain ESM (typed by merge.d.ts) so it runs under `node --test`
 * without a TypeScript toolchain, matching the PWA's node:test approach.
 */

function keyFor(message) {
  return message.clientMessageId || message.id;
}

function asClientMessage(message) {
  return {
    error: null,
    ...message,
    serverSeq: message.serverSeq ?? null,
    createdAtServer: message.createdAtServer ?? null,
  };
}

export function mergeMessages(existing, incoming, maxLocalMessages = 500) {
  const byKey = new Map();
  for (const item of existing) byKey.set(keyFor(item), asClientMessage(item));
  for (const item of incoming) {
    const key = keyFor(item);
    const prev = byKey.get(key);
    const next = asClientMessage(item);
    // Prefer a server-confirmed copy over a local-only one, but never let an
    // unconfirmed re-send clobber a row that already has a serverSeq.
    if (prev && prev.serverSeq != null && next.serverSeq == null) continue;
    byKey.set(key, next);
  }

  return [...byKey.values()]
    .sort((a, b) => {
      const aSeq = a.serverSeq != null ? Number(a.serverSeq) : null;
      const bSeq = b.serverSeq != null ? Number(b.serverSeq) : null;
      if (aSeq !== null && bSeq !== null) return aSeq - bSeq;
      if (aSeq !== null) return -1;
      if (bSeq !== null) return 1;
      return String(a.createdAtClient || "").localeCompare(String(b.createdAtClient || ""));
    })
    .slice(-maxLocalMessages);
}

/** Highest serverSeq across a set of messages (0 if none confirmed). */
export function highestServerSeq(messages) {
  return messages.reduce((max, item) => {
    const seq = Number(item.serverSeq ?? 0);
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);
}

/** Count of inbound (command) messages newer than a read marker. */
export function unreadCount(messages, readSeq) {
  return messages.filter(
    (item) => item.senderType === "command" && Number(item.serverSeq ?? 0) > readSeq,
  ).length;
}
