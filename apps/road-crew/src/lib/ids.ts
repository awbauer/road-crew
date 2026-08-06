/**
 * Generates a stable client message id. The server dedupes on this id, so a
 * retried send must reuse the same value — never mint a new one on retry.
 *
 * Uses crypto.randomUUID when available (Hermes/Expo expose it), otherwise
 * falls back to a timestamp + random suffix that is unique enough for an
 * idempotency key.
 */
export function newClientMessageId(senderType: "van" | "command" = "van"): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid =
    typeof cryptoObj?.randomUUID === "function"
      ? cryptoObj.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
          .toString(36)
          .slice(2)}`;
  return `${senderType}_${uuid}`;
}
