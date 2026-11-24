/**
 * Pure message helpers shared by the synchronization layer. (Merging itself
 * happens in SQLite: see `messageRepository`.)
 *
 * Authored as plain ESM (typed by merge.d.ts) so it runs under `node --test`
 * without a TypeScript toolchain, matching the PWA's node:test approach.
 */

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
