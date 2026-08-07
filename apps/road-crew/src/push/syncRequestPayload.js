/**
 * Parses the silent Command wake out of what the OS actually hands the
 * background notification task.
 *
 * This is deliberately its own module, free of react-native/expo imports, so
 * the shape can be tested against a real transformer payload under `node
 * --test`. It previously lived inline in `backgroundNotification.native.ts`
 * and read one level too shallow, which silently discarded every wake.
 *
 * expo-notifications' iOS `BackgroundEventTransformer` nests every key except
 * `aps` under `data`:
 *
 *   { data: { type, syncRequestId, dataString }, notification: null, aps: {...} }
 *
 * so the Worker's top-level `type`/`syncRequestId` arrive at `payload.data.*`,
 * not `payload.*`. Android delivers the same fields as a JSON string in
 * `data.dataString`. Both are handled, plus a flat payload, so a future change
 * to the wrapper degrades to one of the other shapes instead of silently
 * dropping the wake again.
 */

/** @typedef {{ type: "sync-request", syncRequestId: string }} SyncRequestPayload */

/**
 * Every plausible record the sync request could be carried in, nearest-first.
 * @param {unknown} payload
 * @returns {Record<string, unknown>[]}
 */
function candidateRecords(payload) {
  if (!payload || typeof payload !== "object") return [];
  const outer = /** @type {Record<string, unknown>} */ (payload);
  const inner = outer.data && typeof outer.data === "object"
    ? /** @type {Record<string, unknown>} */ (outer.data)
    : null;
  const records = [];
  // Nested first: that is where both platforms put it today. The outer object
  // is kept as a fallback so a flat payload still resolves.
  for (const record of [inner, outer]) {
    if (!record) continue;
    if (typeof record.dataString === "string") {
      try {
        const parsed = JSON.parse(record.dataString);
        if (parsed && typeof parsed === "object") records.push(parsed);
      } catch {
        // A malformed dataString must not hide the record carrying it.
      }
    }
    records.push(record);
  }
  return records;
}

/**
 * @param {unknown} payload
 * @returns {SyncRequestPayload | null}
 */
export function readSyncRequest(payload) {
  for (const record of candidateRecords(payload)) {
    const syncRequestId = record.syncRequestId;
    if (record.type !== "sync-request") continue;
    if (typeof syncRequestId !== "string" || !syncRequestId.trim()) continue;
    return { type: "sync-request", syncRequestId: syncRequestId.trim() };
  }
  return null;
}

/**
 * A best-effort id for a push that did not parse as a sync request, so an
 * unrecognized wake can still be acknowledged and seen in Command rather than
 * disappearing the way every wake did before this module existed.
 * @param {unknown} payload
 * @returns {string | null}
 */
export function readAnySyncRequestId(payload) {
  for (const record of candidateRecords(payload)) {
    const syncRequestId = record.syncRequestId;
    if (typeof syncRequestId === "string" && syncRequestId.trim()) return syncRequestId.trim();
  }
  return null;
}
