/**
 * Canonical shared types for Road Crew.
 *
 * These describe the baked route data (produced by the Python `route_pipeline`
 * and consumed by both the web and native clients) and the core geo domain.
 * Worker messaging, notification, heartbeat, location, and route contracts all
 * live here so web/native clients cannot drift from one another.
 */

/** A single map coordinate as stored in the baked path files: `[lng, lat]`. */
export type LngLat = [number, number];

/** An ordered polyline for a route (flat `[[lng, lat], ...]` array). */
export type RoutePath = LngLat[];

/**
 * One cue-sheet row. A sequence is a single GPS point on a route: the maneuver
 * to perform when you reach that point while traveling the route forward, plus
 * the road you then travel until the next sequence.
 *
 * Field model (all relative to *forward* travel):
 * - `dir` — the maneuver at this GPS point: "L"/"R"/"S" (turn left, turn right,
 *   or continue straight). This is the per-row arrow.
 * - `street` — the road you are ON after this point, i.e. the road this cue
 *   sends you down until the next sequence. The segment *between* sequence N and
 *   N+1 is therefore named by sequence N's `street` (the lower-indexed end). So
 *   "the road you're currently on" is the `street` of the segment's lower index,
 *   in either travel direction.
 * - `miles` — distance from this sequence to the next one (how far you travel on
 *   `street`). See `distanceToNextSequenceMiles`.
 * - `intersection` — the cross-streets at this GPS point, e.g. "Loyola Road &
 *   McKeown Road" (the road you came in on & `street`).
 *
 * Numeric fields may be `null` in the baked data (e.g. a sequence without a
 * geocoded coordinate), so callers must guard before use. The index signature
 * keeps flag lookups (`seq[flagKey]`) type-safe.
 */
export interface Sequence {
  seq: number;
  /** Maneuver at this GPS point (forward): "L" | "R" | "S". */
  dir?: string | null;
  /** Road you travel after this point, until the next sequence. */
  street?: string | null;
  num_first?: string | number | null;
  num_last?: string | number | null;
  town?: string | null;
  /** Distance from this sequence to the next (miles on `street`). */
  miles?: number | null;
  cum_miles?: number | null;
  /** Cross-streets at this GPS point, e.g. "Prev Road & street". */
  intersection?: string | null;
  first_rider_time?: string | null;
  last_rider_time?: string | null;
  lat?: number | null;
  lng?: number | null;
  road_crew?: boolean | null;
  police?: boolean | null;
  mh_sign?: boolean | null;
  water_stop?: boolean | null;
  marker?: string | null;
  [key: string]: unknown;
}

/** A Cumberland Farms location bundled for offline field-map use. */
export interface CumberlandFarm {
  id: string;
  name: string;
  storeNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  hours?: string;
  lat: number;
  lng: number;
  source: string;
}

/** One route (day + variant) with its ordered sequences. */
export interface Route {
  id: string;
  day?: number | string;
  route?: number | string;
  name?: string;
  start_town?: string;
  end_town?: string;
  official_miles?: number | null;
  sequence_count?: number;
  sequences: Sequence[];
  /** Attached at load time from data/paths/<id>.json when a path file exists. */
  path?: RoutePath;
}

/** The baked master dataset (`sequences.json`). */
export interface RouteData {
  generated_at?: string;
  source?: string;
  routes: Route[];
}

/** A van in the roster (`vans.json` / `/api/vans`). */
export interface Van {
  number: string;
  label: string;
}

export type SenderType = "van" | "command";
export type MessageStatus = "sent";
export type LocalMessageStatus = "queued" | "sending" | "failed";

export interface ServerMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  vanId: string;
  senderType: SenderType;
  senderId: string;
  body: string;
  scope: string;
  status: MessageStatus;
  createdAtClient: string;
  createdAtServer: string;
  serverSeq: number;
}

export interface ClientMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  vanId: string;
  senderType: SenderType;
  senderId: string;
  body: string;
  scope: string;
  status: MessageStatus | LocalMessageStatus;
  createdAtClient: string;
  createdAtServer: string | null;
  serverSeq: number | null;
  error?: string | null;
}

export interface PostVanMessageBody {
  clientMessageId: string;
  body: string;
  createdAtClient: string;
}

export interface PostVanMessageResponse {
  message: ServerMessage;
}

export interface ListVanMessagesResponse {
  messages: ServerMessage[];
}

export interface ListVansResponse {
  vans: Van[];
  hidden?: boolean;
}

export interface PostLocationBody {
  vanId: string;
  deviceId: string;
  lat: number;
  lng: number;
  ts: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
}

/** A foreground heartbeat fix can arrive before a van-install selects a van. */
export type HeartbeatLocationBody = Omit<PostLocationBody, "vanId"> & {
  vanId?: string | null;
};

export interface HeartbeatRequest {
  location?: HeartbeatLocationBody | null;
  vanId?: string | null;
  routeId?: string | null;
  vanInstall?: boolean;
  /** Whether native background location tracking is currently applied. */
  trackingEnabled?: boolean;
  adminActionAck?: string | null;
  /** Correlates a headless push wake with the heartbeat it triggered. */
  backgroundSyncRequestId?: string | null;
  /** Identifies the client path that produced this heartbeat. */
  heartbeatSource?: "foreground" | "location-task" | "scheduled-task" | "silent-push" | null;
  /**
   * The trigger within that path — "launch", "focus", "interval", "reconnect",
   * "visibility", "admin-action-ack". `heartbeatSource` says which subsystem
   * sent it; this says why, which is what makes a burst attributable.
   */
  heartbeatReason?: string | null;
  appBuild?: string;
  appRelease?: string;
  appVersion?: string;
  buildNumber?: string;
  releaseVersion?: string;
  platform?: string;
  /**
   * Hardware form factor — "phone", "tablet", "desktop", or "unknown".
   * `platform` only reports the OS, so an iPhone and an iPad both report
   * "ios"; this is what tells them apart in Command.
   */
  deviceType?: string;
}

export interface HeartbeatLocationReport {
  ok: boolean;
  error?: string | null;
}

/** Runtime policy for the native tracked-van background location task. */
export interface HeartbeatBackgroundLocationPolicy {
  pausesUpdatesAutomatically: boolean;
}

/** Worker-authoritative policy for native background GPS and its local control. */
export interface HeartbeatLocationTrackingPolicy {
  enabled: boolean;
}

export interface DeviceAdminAction {
  id: string;
  type: "reset-van" | "set-route";
  createdAt: number;
  routeId?: string;
}

/**
 * An operator's pending tracking change, in the same shape as every other
 * device command. Present only while a real command is outstanding.
 */
export interface DeviceTrackingCommand {
  id: string;
  value: boolean;
  createdAt: number;
}

export interface HeartbeatResponse {
  ok: boolean;
  status: string;
  /** Worker time when this heartbeat was accepted; anchors Last ping offline. */
  serverNow?: number;
  deviceIdReceived: boolean;
  notifications: NotificationItem[];
  locationReport: HeartbeatLocationReport | null;
  backgroundLocationPolicy: HeartbeatBackgroundLocationPolicy;
  /** When false, clients stop background tracking and hide its local control. */
  /** Absent when communicating with an older Worker. */
  locationTrackingPolicy?: HeartbeatLocationTrackingPolicy;
  /**
   * The device's tracking state as the Worker last observed it, or a pending
   * command's desired value when one exists.
   *
   * Clients must not adopt this. When no command is pending it is an echo of
   * the device's own last report, so it is always downstream of local state and
   * adopting it can only undo a newer change the device has already applied —
   * which is exactly how a driver's "Tracked" toggle used to get reverted.
   * Adopt `trackingCommand` instead; this field remains for older builds.
   */
  trackingEnabled: boolean;
  /** The only authoritative instruction to change tracking. Null when none. */
  trackingCommand: DeviceTrackingCommand | null;
  adminAction: DeviceAdminAction | null;
}

export interface VersionResponse {
  ok: boolean;
  status: string;
  buildNumber: string | number;
  releaseVersion: string | null;
  deviceIdReceived?: boolean;
}

export interface VanLocation {
  vanId: string;
  deviceId: string | null;
  /** Route selected by the reporting van, when its heartbeat is available. */
  routeId?: string | null;
  lat: number;
  lng: number;
  ts: number;
  accuracy: number | null;
  heading: number | null;
}

export interface ListLocationsResponse {
  locations: VanLocation[];
}

export interface FeatureFlags {
  messaging: boolean;
}

export interface MessagesBootstrapResponse {
  vans: Van[];
  hidden?: boolean;
  messages: ServerMessage[];
  features: FeatureFlags;
}

export interface ConversationSummary {
  conversationId: string;
  vanId: string;
  vanLabel?: string;
  latestMessage: ServerMessage | null;
  lastServerSeq: number;
  lastMessageAt: string | null;
  unreadCount: number;
  hasUnread: boolean;
}

export type NotificationSeverity = "info" | "high";
export type NotificationType = "message" | "go-to-sequence";
export type NotificationScope = "global" | "van" | "route";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  target: { scope: NotificationScope; value: string | null };
  title: string;
  body: string;
  action: { kind: "go-to-sequence"; routeId: string; seq: number } | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface RouteSummary {
  id: string;
  day: number;
  route: number;
  name: string;
  start_town: string;
  end_town: string;
  official_miles: number;
  sequence_count: number;
}

export function conversationIdForVan(vanId: string): string {
  return `van:${vanId}`;
}
