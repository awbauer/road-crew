// Pure notification helpers only - no DOM/polling/
// storage side effects; those live in the app layer. Behavior is
// intentionally unchanged: normalize a raw feed, filter to what's visible,
// and maintain a reviewable Notification Center archive.

export type NotificationType = "message" | "go-to-sequence" | "app-update";
export type NotificationSeverity = "info" | "high";
export type NotificationScope = "global" | "van" | "route";

export interface GoToSequenceNotificationAction {
  kind: "go-to-sequence";
  routeId: string | null;
  seq: number;
}

export interface UpdateAppNotificationAction {
  kind: "update-app";
}

export type NotificationAction = GoToSequenceNotificationAction | UpdateAppNotificationAction;

export interface SanitizedNotification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  target: { scope: NotificationScope; value: string | null };
  title: string;
  body: string;
  pinned: boolean;
  action: NotificationAction | null;
  createdAt: string | null;
  expiresAt: string | null;
  createdMs: number;
  expiresMs: number | null;
  /** Command notices are reconciled with the live feed; app-generated notices
   * stay in the local archive so completed updates remain reviewable. */
  source: "remote" | "local";
}

export interface ArchivedNotification extends SanitizedNotification {
  read: boolean;
  firstSeenAt: number;
}

export interface CenterNotification extends ArchivedNotification {
  expired: boolean;
  pinnedActive: boolean;
}

const VALID_TYPES: NotificationType[] = ["message", "go-to-sequence", "app-update"];
const VALID_SCOPES: NotificationScope[] = ["global", "van", "route"];

function parseTime(v: unknown): number | null {
  if (v == null) return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function sanitizeAction(a: unknown): NotificationAction | null {
  if (!a || typeof a !== "object") return null;
  const rec = a as Record<string, unknown>;
  if (rec.kind === "update-app") return { kind: "update-app" };
  if (rec.kind !== "go-to-sequence") return null;
  const seq = Number(rec.seq);
  if (!Number.isFinite(seq)) return null;
  return {
    kind: "go-to-sequence",
    routeId: typeof rec.routeId === "string" ? rec.routeId : null,
    seq,
  };
}

/** Normalize a raw feed entry. Returns null only when unusable (not an
 * object, or missing a stable id). Unknown enum values default rather than
 * drop, so a typo in the feed still surfaces something. */
export function sanitizeNotification(raw: unknown): SanitizedNotification | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id : (rec.id != null ? String(rec.id) : "");
  if (!id) return null;

  const rawTarget = rec.target && typeof rec.target === "object" ? (rec.target as Record<string, unknown>) : {};
  const scope = VALID_SCOPES.includes(rawTarget.scope as NotificationScope) ? (rawTarget.scope as NotificationScope) : "global";

  return {
    id,
    type: VALID_TYPES.includes(rec.type as NotificationType) ? (rec.type as NotificationType) : "message",
    severity: rec.severity === "high" ? "high" : "info",
    target: { scope, value: (rawTarget.value as string | null) ?? null },
    title: typeof rec.title === "string" ? rec.title : "",
    body: typeof rec.body === "string" ? rec.body : "",
    pinned: rec.pinned === true,
    action: sanitizeAction(rec.action),
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : null,
    expiresAt: typeof rec.expiresAt === "string" ? rec.expiresAt : null,
    createdMs: parseTime(rec.createdAt) ?? 0,
    expiresMs: parseTime(rec.expiresAt),
    source: "remote",
  };
}

export function isExpired(n: { expiresMs: number | null } | null | undefined, nowMs = Date.now()): boolean {
  const exp = n?.expiresMs;
  if (exp == null) return false;
  return exp <= nowMs;
}

export function matchesTarget(
  n: { target: { scope: NotificationScope; value: string | null } },
  { vanNumber = null, routeId = null }: { vanNumber?: string | null; routeId?: string | null } = {},
): boolean {
  const scope = n?.target?.scope || "global";
  if (scope === "global") return true;
  if (scope === "van") {
    if (vanNumber == null || vanNumber === "") return false;
    return String(n.target.value) === String(vanNumber);
  }
  if (scope === "route") {
    if (!routeId) return false;
    return n.target.value === routeId;
  }
  return true;
}

/** Filter a raw feed down to what should display now: well-formed, targeted
 * at this crew, not expired, not already seen. Dedups by id (last wins) and
 * orders newest-first. */
export function selectVisible(
  list: unknown[],
  { vanNumber = null, routeId = null, seenIds = {}, nowMs = Date.now() }: {
    vanNumber?: string | null;
    routeId?: string | null;
    seenIds?: Record<string, number>;
    nowMs?: number;
  } = {},
): SanitizedNotification[] {
  if (!Array.isArray(list)) return [];
  const byId = new Map<string, SanitizedNotification>();
  for (const raw of list) {
    const n = sanitizeNotification(raw);
    if (n) byId.set(n.id, n);
  }
  const seen = seenIds || {};
  const visible: SanitizedNotification[] = [];
  for (const n of byId.values()) {
    if (!matchesTarget(n, { vanNumber, routeId })) continue;
    if (isExpired(n, nowMs)) continue;
    if (Object.prototype.hasOwnProperty.call(seen, n.id)) continue;
    visible.push(n);
  }
  visible.sort((a, b) => b.createdMs - a.createdMs);
  return visible;
}

/** Keep the seen-map bounded: drop ids that are gone from the feed AND older
 * than the TTL, then cap to the newest entries. */
export function pruneSeen(
  seenMap: Record<string, number> | null | undefined,
  list: unknown[],
  nowMs = Date.now(),
  { ttlMs = 7 * 24 * 60 * 60 * 1000, cap = 500 }: { ttlMs?: number; cap?: number } = {},
): Record<string, number> {
  const present = new Set(
    (Array.isArray(list) ? list : [])
      .map((r) => sanitizeNotification(r))
      .filter((n): n is SanitizedNotification => Boolean(n))
      .map((n) => n.id),
  );
  const out: Record<string, number> = {};
  for (const [id, seenAt] of Object.entries(seenMap || {})) {
    const ts = Number(seenAt) || 0;
    if (present.has(id) || (nowMs - ts) < ttlMs) out[id] = ts;
  }
  const entries = Object.entries(out);
  if (entries.length > cap) {
    entries.sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(entries.slice(0, cap));
  }
  return out;
}

/** Targeted, deduped sanitized items for this crew. Unlike selectVisible this
 * does NOT filter out already-seen ids or expired items — the center is a
 * review surface, so it carries everything and lets the caller annotate. */
export function selectForCenter(
  list: unknown[],
  { vanNumber = null, routeId = null }: { vanNumber?: string | null; routeId?: string | null } = {},
): SanitizedNotification[] {
  if (!Array.isArray(list)) return [];
  const byId = new Map<string, SanitizedNotification>();
  for (const raw of list) {
    const n = sanitizeNotification(raw);
    if (n && matchesTarget(n, { vanNumber, routeId })) byId.set(n.id, n);
  }
  return [...byId.values()];
}

/** Merge freshly-fetched items into the persisted archive, preserving each
 * item's read flag and original arrival time. Returns a new archive map. */
export function upsertArchive(
  archive: Record<string, ArchivedNotification> | null | undefined,
  items: SanitizedNotification[],
  nowMs = Date.now(),
): Record<string, ArchivedNotification> {
  const out: Record<string, ArchivedNotification> = { ...(archive && typeof archive === "object" ? archive : {}) };
  for (const n of items) {
    const prev = out[n.id];
    out[n.id] = {
      ...n,
      read: prev ? prev.read === true : false,
      firstSeenAt: prev ? (Number(prev.firstSeenAt) || nowMs) : nowMs,
    };
  }
  return out;
}

/** Keep the archive bounded: drop entries older than the TTL, then cap to the
 * most recently arrived. Pinned items are kept preferentially. */
export function pruneArchive(
  archive: Record<string, ArchivedNotification> | null | undefined,
  nowMs = Date.now(),
  { ttlMs = 7 * 24 * 60 * 60 * 1000, cap = 200 }: { ttlMs?: number; cap?: number } = {},
): Record<string, ArchivedNotification> {
  const entries = Object.entries(archive && typeof archive === "object" ? archive : {})
    .filter(([, n]) => n && (nowMs - (Number(n.firstSeenAt) || 0)) < ttlMs);
  entries.sort((a, b) => {
    const pinned = (a[1].pinned === true ? 1 : 0) - (b[1].pinned === true ? 1 : 0);
    if (pinned) return -pinned;
    return (Number(b[1].firstSeenAt) || 0) - (Number(a[1].firstSeenAt) || 0);
  });
  return Object.fromEntries(entries.slice(0, cap));
}

/** Drop archive entries that are gone from the live feed but have NOT
 * naturally expired (they were deleted by Command). Only call this when the
 * feed response was successful — callers must not pass a list from a
 * failed/offline fetch. */
export function reconcileArchive(
  archive: Record<string, ArchivedNotification> | null | undefined,
  list: unknown[],
  nowMs = Date.now(),
): Record<string, ArchivedNotification> {
  if (!archive || typeof archive !== "object") return {};
  const liveIds = new Set(
    (Array.isArray(list) ? list : [])
      .map(sanitizeNotification)
      .filter((n): n is SanitizedNotification => Boolean(n))
      .map((n) => n.id),
  );
  const out: Record<string, ArchivedNotification> = {};
  for (const [id, item] of Object.entries(archive)) {
    if (item.source === "local" || liveIds.has(id) || isExpired(item, nowMs)) out[id] = item;
  }
  return out;
}

/** Order for the Notification Center: active pinned first, then other active
 * items (newest-first), then expired items (newest-first). */
export function sortForCenter(archiveItems: ArchivedNotification[], nowMs = Date.now()): CenterNotification[] {
  const items = (Array.isArray(archiveItems) ? archiveItems : []).map((n) => ({
    ...n,
    expired: isExpired(n, nowMs),
    pinnedActive: n.pinned === true && !isExpired(n, nowMs),
  }));
  const rank = (n: CenterNotification) => (n.pinnedActive ? 0 : n.expired ? 2 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || (b.createdMs - a.createdMs));
}

/** Unread = not yet reviewed AND still active (expired items never keep the
 * badge lit). */
export function unreadCount(archiveItems: Array<{ read: boolean } & { expiresMs: number | null }>, nowMs = Date.now()): number {
  return (Array.isArray(archiveItems) ? archiveItems : [])
    .filter((n) => n && n.read !== true && !isExpired(n, nowMs)).length;
}
