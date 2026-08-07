import { FontAwesome6 } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import { useIsFocused } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@road-crew/ui";
import {
  fmtMiles,
  distanceToNextSequenceMiles,
  sequenceAddress,
  hasCoordinates,
  directionLabel,
  sequenceFlags,
  parseQuery,
  matchSequence,
  findCrossRouteMatches,
} from "@road-crew/core";
import type { Route, Sequence } from "@road-crew/contracts";
import { getRouteById } from "@road-crew/data";
import { useRoutes } from "@/field/useRoutes";
import { useSharedGeolocation } from "@/field/Geolocation";
import { useKeepAwakeWhen } from "@/field/useKeepAwakeWhen";
import { useFleet } from "@/field/useFleet";
import { useSequenceJumpRequest } from "@/field/useSequenceJumpRequest";
import { useSession } from "@/auth/SessionProvider";
import { useNotifications } from "@/notifications/NotificationsProvider";
import { computeGpsStatus, type GpsStatus } from "@/field/gpsStatus";
import { useGpsStatus } from "@/field/useGpsStatus";
import { shouldUseNativeAnimationDriver } from "@/ui/animationDriver";
import { GpsPanel } from "@/field/GpsPanel";
import { useSelectedRoute } from "@/field/RouteSelection";
import { RoutePicker } from "@/field/RoutePicker";
import { useStatusSheet } from "@/field/StatusSheet";
import { useSettings, type NavProvider } from "@/field/Settings";
import { openSequenceNavigation } from "@/field/navigationLauncher";
import {
  MANUAL_SCROLL_SETTLE_MS,
  isFollowAutoScrollPaused,
} from "@/field/followPause";
import RouteMap from "@/field/RouteMap";
import { ModalHeader } from "@/ui/ModalHeader";
import { ModalShell } from "@/ui/ModalShell";
import { pressFeedback } from "@/ui/pressFeedback";

const logo = require("../../public/icons/road-crew-logo.png");
const openUrl = (url: string) => Linking.openURL(url);

// Land the next sequence around the middle of the viewport.
const FOLLOW_VIEW_POSITION = 0.5;

const DIR_ICON: Record<string, React.ComponentProps<typeof FontAwesome6>["name"]> = {
  L: "arrow-left",
  R: "arrow-right",
  S: "arrow-up",
};
const DIR_BG: Record<string, string> = {
  L: colors.brandRed,
  R: colors.amber,
  S: "#5b5b63",
};

type Row = { kind: "seq"; seq: Sequence; index: number } | { kind: "gap"; miles: string; key: string };

function riderTimes(seq: Sequence): string | null {
  const first = seq.first_rider_time;
  const last = seq.last_rider_time;
  if (!first && !last) return null;
  return first && last && first !== last ? `${first} – ${last}` : (first || last) || null;
}

/** Flag chips, matching app/js/list.js (label + per-type color). */
const Flags = memo(function Flags({ seq }: { seq: Sequence }) {
  const chips: Array<{ label: string; bg: string }> = [];
  if (seq.water_stop) chips.push({ label: "Water", bg: "#3b3b42" });
  if (seq.police) chips.push({ label: "Police", bg: colors.brandRedDark });
  if (seq.road_crew) chips.push({ label: "Road crew", bg: colors.green });
  if (seq.mh_sign) chips.push({ label: "MH sign", bg: colors.amber });
  if (!chips.length) return null;
  return (
    <View style={styles.badges}>
      {chips.map((c) => (
        <Text key={c.label} style={[styles.badge, { backgroundColor: c.bg }]}>
          {c.label.toUpperCase()}
        </Text>
      ))}
    </View>
  );
});

const SequenceCard = memo(function SequenceCard({
  seq,
  prev,
  onOpen,
  isNext,
  blink,
  navProvider,
  driverMode,
}: {
  seq: Sequence;
  prev?: Sequence;
  onOpen: (seq: Sequence) => void;
  isNext: boolean;
  blink: boolean;
  navProvider: NavProvider;
  driverMode: boolean;
}) {
  const dir = (seq.dir || "S").toUpperCase();
  // Navigation goes to the sequence's GPS point, so the coordinate — not the
  // address text — is what decides whether the nav button can do anything.
  const canNavigate = hasCoordinates(seq);
  const entersTown = Boolean(seq.town && seq.town !== prev?.town);
  const mileage = fmtMiles(seq.cum_miles, 1);
  const times = riderTimes(seq);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isNext && blink) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 0.3,
            duration: 500,
            useNativeDriver: shouldUseNativeAnimationDriver(Platform.OS),
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 500,
            useNativeDriver: shouldUseNativeAnimationDriver(Platform.OS),
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(1);
  }, [isNext, blink, pulse]);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && pressFeedback.activeSubtle]}
      onPress={() => onOpen(seq)}
      accessibilityRole="button"
      accessibilityLabel={`Open sequence ${seq.seq} details`}
    >
      {isNext ? <Animated.View pointerEvents="none" style={[styles.nextOutline, { opacity: pulse }]} /> : null}
      {isNext ? <View style={styles.nextRail} /> : null}
      <View style={styles.num}>
        <View style={[styles.dir, { backgroundColor: DIR_BG[dir] || "#5b5b63" }]}>
          <FontAwesome6 name={DIR_ICON[dir] || "location-dot"} size={21} color="#fff" />
        </View>
        <Text style={[styles.numMain, driverMode && styles.numMainLg]}>{seq.seq}</Text>
        {mileage ? <Text style={styles.mileTotal}>{mileage}</Text> : null}
      </View>

      <View style={styles.body}>
        {seq.town ? (
          <Text style={styles.townLine}>
            {entersTown ? <Text style={styles.townEntry}>◆ </Text> : null}
            {seq.town}
          </Text>
        ) : null}
        <Text style={[styles.streetLine, driverMode && styles.streetLineLg]} numberOfLines={1}>
          {seq.street || "—"}
        </Text>
        {times ? (
          <View style={styles.times}>
            <FontAwesome6 name="clock" size={11} color={colors.textMuted} />
            <Text style={styles.timesText}>{times}</Text>
          </View>
        ) : null}
        <Flags seq={seq} />
      </View>

      <Pressable
        style={({ pressed }) => [styles.nav, pressed && pressFeedback.active]}
        disabled={!canNavigate}
        onPress={(e) => {
          e?.stopPropagation?.();
          if (canNavigate) void openSequenceNavigation(openUrl, seq, navProvider);
        }}
        accessibilityRole="button"
        accessibilityLabel="Navigate to this sequence"
      >
        <FontAwesome6 name="location-arrow" size={16} color={colors.brandRed} />
      </Pressable>
    </Pressable>
  );
});

function num(v: unknown): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : String(v);
}

function DetailModal({ seq, onClose }: { seq: Sequence | null; onClose: () => void }) {
  if (!seq) return null;
  const address = sequenceAddress(seq);
  const flags = sequenceFlags(seq);
  const nums = [num(seq.num_first), num(seq.num_last)].filter(Boolean);
  const rider = riderTimes(seq);

  // Every populated source field (the legacy detail popup showed these).
  const details: Array<[string, string | null]> = [
    ["Direction", seq.dir ? directionLabel(seq.dir) : null],
    ["Town", seq.town ?? null],
    ["Address #", nums.length ? nums.join("–") : null],
    ["Intersection", seq.intersection ?? null],
    ["Distance to next", fmtMiles(seq.miles, 2)],
    // 1 decimal matches legacy's fmtMiles(seq.cum_miles, 1) in openSeqDetail.
    ["Cumulative miles", fmtMiles(seq.cum_miles, 1)],
    ["Rider times", rider],
    ["Flags", flags.length ? flags.join(", ") : null],
    // 6 decimals matches legacy's #seq-detail-coords formatting.
    ["Coordinates", Number.isFinite(seq.lat) && Number.isFinite(seq.lng) ? `${(seq.lat as number).toFixed(6)}, ${(seq.lng as number).toFixed(6)}` : null],
  ];

  const providers = [
    { label: "Apple Maps", provider: "apple" },
    { label: "Google Maps", provider: "google" },
    { label: "Waze", provider: "waze" },
  ] as const;

  return (
    <ModalShell visible maxWidth={480} onClose={onClose}>
      <ModalHeader kicker={`SEQUENCE ${seq.seq}`} title={seq.street || "—"} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
        {address ? <Text style={styles.modalAddr}>{address}</Text> : null}

        <View style={styles.modalDetails}>
          {details
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <View key={k} style={styles.modalDetailRow}>
                <Text style={styles.modalDetailK}>{k}</Text>
                <Text style={styles.modalDetailV}>{v}</Text>
              </View>
            ))}
        </View>

        <View style={styles.modalActions}>
          {providers.map((p) => (
            <Pressable
              key={p.label}
              style={({ pressed }) => [styles.modalBtn, pressed && pressFeedback.active]}
              onPress={() => {
                void openSequenceNavigation(openUrl, seq, p.provider);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Navigate with ${p.label}`}
            >
              <FontAwesome6 name="diamond-turn-right" size={16} color="#fff" />
              <Text style={styles.modalBtnText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ModalShell>
  );
}

const GapRow = memo(function GapRow({ miles }: { miles: string }) {
  return (
    <View style={styles.gap}>
      <Text style={styles.gapMarker}>◆</Text>
      <Text style={styles.gapDistance}>{miles}</Text>
    </View>
  );
});

function Header({
  route,
  onOpenPicker,
  onOpenStatus,
  onOpenNotifications,
  unreadNotifications,
  follow,
  onToggleFollow,
  wide,
  landscape,
  status,
  appStatusLabel,
  appStatusPillStyle,
  onSearch,
}: {
  route: Route;
  onOpenPicker: () => void;
  onOpenStatus: () => void;
  onOpenNotifications: () => void;
  unreadNotifications: number;
  follow: boolean;
  onToggleFollow: () => void;
  wide: boolean;
  landscape: boolean;
  status: GpsStatus;
  appStatusLabel: string;
  appStatusPillStyle: ViewStyle;
  onSearch: () => void;
}) {
  return (
    <View style={styles.topbar}>
      <Image source={logo} style={styles.topLogo} accessibilityLabel="Road Crew logo" />
      <Pressable
        style={({ pressed }) => [styles.routeCol, wide && styles.routeColWide, pressed && pressFeedback.activeSubtle]}
        onPress={onOpenPicker}
        accessibilityRole="button"
        accessibilityLabel="Change route"
      >
        <Text style={styles.routeName} numberOfLines={1}>
          {route.name || route.id}
        </Text>
        <Text style={styles.routeMeta} numberOfLines={1}>
          Day {route.day} · {route.sequence_count ?? route.sequences.length} seqs · {route.official_miles} mi
        </Text>
      </Pressable>
      {/* On tablet/wide the GPS bar lives in the header, between the route info
          and the top-right icons. */}
      {wide ? (
        <View style={[styles.headerGps, landscape && styles.headerGpsLandscape]}>
          <GpsPanel
            status={status}
            // The tablet header row is taller than the phone GPS row, so let
            // the street sign span its full height.
            fillHeight
            beforeStatus={landscape ? (
              <GpsSequenceSide
                seqNum={status.prevSeqNum}
                distance={status.prevDistanceLabel}
                label="Prev"
                tone="previous"
              />
            ) : null}
            afterStatus={landscape ? (
              <GpsSequenceSide
                seqNum={status.nextSeqNum}
                distance={status.nextDistanceLabel}
                label="Next"
                tone="next"
              />
            ) : null}
          />
        </View>
      ) : null}
      <View style={styles.pills}>
        {wide ? (
          <Pressable
            style={({ pressed }) => [
              styles.circleBtn,
              { backgroundColor: colors.bgControl },
              pressed && pressFeedback.active,
            ]}
            onPress={onSearch}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <FontAwesome6 name="magnifying-glass" size={16} color="#fff" />
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.circleBtn,
            { backgroundColor: follow ? colors.brandRedDark : "#5b5b63" },
            pressed && pressFeedback.active,
          ]}
          onPress={onToggleFollow}
          accessibilityRole="button"
          accessibilityState={{ selected: follow }}
          accessibilityLabel="Toggle follow"
        >
          <FontAwesome6 name="location-crosshairs" size={16} color="#fff" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.circleBtn,
            { backgroundColor: colors.bgControl },
            pressed && pressFeedback.active,
          ]}
          onPress={onOpenNotifications}
          accessibilityRole="button"
          accessibilityLabel="Open notifications"
        >
          <FontAwesome6 name="bell" size={16} color="#fff" />
          {unreadNotifications > 0 ? (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>{unreadNotifications > 9 ? "9+" : unreadNotifications}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.livePill, appStatusPillStyle, pressed && pressFeedback.active]}
          onPress={onOpenStatus}
          accessibilityRole="button"
          accessibilityLabel={`Open status: ${appStatusLabel}`}
        >
          <Text style={styles.livePillText} numberOfLines={1}>{appStatusLabel} ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

function GpsSequenceSide({
  seqNum,
  distance,
  label,
  tone,
}: {
  seqNum: number | null;
  distance: string | null;
  label: "Prev" | "Next";
  tone: "previous" | "next";
}) {
  return (
    <View style={styles.gpsSequenceSide} testID={`gps-sequence-${tone}`}>
      {seqNum != null ? (
        <>
          <Text style={[styles.gpsSequenceLabel, tone === "next" ? styles.gpsSequenceLabelNext : styles.gpsSequenceLabelPrevious]}>
            {label}
          </Text>
          <Text style={styles.gpsSequenceNumber} numberOfLines={1}>#{seqNum}</Text>
          {distance ? <Text style={styles.gpsSequenceDistance} numberOfLines={1}>{distance}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function GpsRow({ status, onSearch }: { status: GpsStatus; onSearch: () => void }) {
  return (
    <View style={styles.gpsRow}>
      <GpsPanel status={status} />
      <Pressable
        style={({ pressed }) => [styles.searchBtn, pressed && pressFeedback.active]}
        onPress={onSearch}
        accessibilityRole="button"
        accessibilityLabel="Search"
      >
        <FontAwesome6 name="magnifying-glass" size={16} color={colors.text} />
      </Pressable>
    </View>
  );
}

function SearchBar({ query, onChange, onClose }: { query: string; onChange: (q: string) => void; onClose: () => void }) {
  return (
    <View style={styles.searchRow}>
      <FontAwesome6 name="magnifying-glass" size={14} color={colors.textSubtle} />
      <TextInput
        style={styles.searchInput}
        value={query}
        onChangeText={onChange}
        placeholder="Search street, town, or #seq"
        placeholderTextColor={colors.textSubtle}
        autoFocus
        keyboardType="default"
        returnKeyType="search"
      />
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close search">
        <FontAwesome6 name="xmark" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function SearchResultsHeader({
  activeMatches,
  crossMatches,
  isSeqQuery,
  onSwitchRoute,
}: {
  activeMatches: number;
  crossMatches: Array<{ route: Route; seq: Sequence }>;
  isSeqQuery: boolean;
  onSwitchRoute: (route: Route, seq: Sequence) => void;
}) {
  // Matches legacy (app/js/main.js applySearch): the cross-route hint only
  // surfaces for a bare sequence-number query (even if it already matched on
  // the active route) or when the active route had zero matches — not for
  // every text query that happens to also match elsewhere.
  const showCrossRouteHint = crossMatches.length > 0 && (isSeqQuery || activeMatches === 0);
  if (!showCrossRouteHint && activeMatches > 0) return null;
  return (
    <View style={styles.searchResultsHeader}>
      {showCrossRouteHint ? (
        <View style={styles.crossRouteHint}>
          <Text style={styles.crossRouteLabel}>
            {activeMatches > 0 ? "Also found on" : "No matches on this route. Found in"}
          </Text>
          <View style={styles.crossRouteButtons}>
            {crossMatches.map(({ route, seq }) => (
              <Pressable
                key={`${route.id}-${seq.seq}`}
                style={styles.crossRouteButton}
                onPress={() => onSwitchRoute(route, seq)}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${route.name || route.id}, sequence ${seq.seq}`}
              >
                <Text style={styles.crossRouteButtonText} numberOfLines={1}>
                  {route.name || route.id} · #{seq.seq}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {!showCrossRouteHint && activeMatches === 0 ? (
        <Text style={styles.noMatches}>No matches.</Text>
      ) : null}
    </View>
  );
}

function Progress({
  route,
  progress,
  direction,
}: {
  route: Route;
  progress: number;
  direction?: "forward" | "reverse" | null;
}) {
  const pct = `${Math.max(0, Math.min(1, progress)) * 100}%` as `${number}%`;
  // When patrolling in reverse, point the marker back toward the start.
  const chevron = direction === "reverse" ? "chevron-left" : "chevron-right";
  return (
    <View style={styles.progress}>
      <Text style={styles.progressEnd}>{route.start_town}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: pct }]} />
        <View style={[styles.progressMarker, { left: pct }]}>
          <FontAwesome6 name={chevron} size={9} color="#fff" />
        </View>
      </View>
      <Text style={styles.progressEnd}>{route.end_town}</Text>
    </View>
  );
}

export default function SequencesScreen({ combined = false }: { combined?: boolean }) {
  const { data, error } = useRoutes();
  const { routeId, ready: routeReady, setRouteId } = useSelectedRoute();
  const route = data && routeId ? (getRouteById(data, routeId) ?? undefined) : undefined;
  const params = useLocalSearchParams<{ search?: string }>();
  const sequenceJump = useSequenceJumpRequest();
  const [searchOpen, setSearchOpen] = useState(params.search === "1");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Sequence | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  useKeepAwakeWhen(true);
  const listRef = useRef<FlatList<Row>>(null);
  const listOffset = useRef(0);
  const userScrolledAt = useRef(0);
  const manualScrollActive = useRef(false);
  const manualTouchActive = useRef(false);
  const manualMomentumActive = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followScrollActive = useRef(false);
  const followScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followToggleRequestId = useRef(0);
  const lastFollowTarget = useRef<string | null>(null);
  const statusSheet = useStatusSheet();
  const notifications = useNotifications();
  const { settings, update: updateSettings } = useSettings();
  const setCumberlandFarmsVisible = useCallback((visible: boolean) => {
    updateSettings({ cumberlandFarmsVisible: visible });
  }, [updateSettings]);
  // Orientation drives the split direction, so it has to match what is actually
  // on screen. `useWindowDimensions` is the app window, which on iPad lags a
  // rotation (and can report transposed values mid-rotation), leaving the
  // portrait stack rendered on a landscape screen. Measuring the root frame is
  // authoritative and self-corrects, so it wins once the first layout lands.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const onRootLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (!width || !height) return;
    setFrame((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  const width = frame?.width ?? windowWidth;
  const height = frame?.height ?? windowHeight;
  const isLandscapeTablet = combined && width > height;
  const isFocused = useIsFocused();
  const { vanId } = useSession();
  // The combined Route workspace owns its own map surface, so it must poll the
  // fleet just like the dedicated Map tab. Keep the poll scoped to the focused
  // combined view so phone Sequences screens do not create a second reader.
  const fleet = useFleet(combined && isFocused);
  const { fix, requestFix } = useSharedGeolocation();
  const status = useGpsStatus(fix, route);
  const needsRoute = Boolean(data && routeReady && !route);
  const parsedQuery = useMemo(() => parseQuery(query), [query]);

  useEffect(() => () => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    if (followScrollTimer.current) clearTimeout(followScrollTimer.current);
    if (followRetryTimer.current) clearTimeout(followRetryTimer.current);
    followToggleRequestId.current += 1;
  }, []);

  useEffect(() => {
    if (needsRoute) setPickerOpen(true);
  }, [needsRoute]);

  // A tapped "Go to sequence" notification action lands here: switch route if
  // needed, then reuse the existing search-jump mechanism (matches the
  // cross-route search "switch" behavior).
  useEffect(() => {
    if (!notifications.pendingGoTo) return;
    const { routeId: targetRouteId, seq } = notifications.pendingGoTo;
    if (targetRouteId && targetRouteId !== routeId) setRouteId(targetRouteId);
    setQuery(`#${seq}`);
    setSearchOpen(true);
    userScrolledAt.current = Date.now();
    lastFollowTarget.current = null;
    notifications.consumePendingGoTo();
  }, [notifications.consumePendingGoTo, notifications.pendingGoTo, routeId, setRouteId]);

  const rows = useMemo<Row[]>(() => {
    if (!route) return [];
    const seqs = route.sequences;
    // When filtering (non-empty query), drop the gap rows — matches the legacy
    // applyFilter behavior in app/js/list.js.
    if (parsedQuery.kind !== "empty") {
      return seqs
        .map((seq, index) => ({ seq, index }))
        .filter(({ seq }) => matchSequence(seq, parsedQuery))
        .map(({ seq, index }) => ({ kind: "seq" as const, seq, index }));
    }
    const out: Row[] = [];
    seqs.forEach((seq, index) => {
      out.push({ kind: "seq", seq, index });
      if (index < seqs.length - 1) {
        const miles = fmtMiles(distanceToNextSequenceMiles(seqs, index), 1) || "—";
        out.push({ kind: "gap", miles, key: `gap-${index}` });
      }
    });
    return out;
  }, [route, parsedQuery]);

  const activeSearchMatches = parsedQuery.kind === "empty" ? 0 : rows.filter((row) => row.kind === "seq").length;
  const crossRouteMatches = useMemo(
    () => data && route ? findCrossRouteMatches(data.routes, route.id, parsedQuery) : [],
    [data, parsedQuery, route],
  );

  const switchToSearchResult = (nextRoute: Route, seq: Sequence) => {
    setRouteId(nextRoute.id);
    setQuery(`#${seq.seq}`);
    setSearchOpen(true);
    userScrolledAt.current = Date.now();
    lastFollowTarget.current = null;
  };

  const rowIndexBySeq = useMemo(() => {
    const bySeq = new Map<number, number>();
    rows.forEach((row, index) => {
      if (row.kind === "seq") bySeq.set(row.seq.seq, index);
    });
    return bySeq;
  }, [rows]);

  const clearManualScrollTimer = () => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = null;
  };

  const clearFollowRetryTimer = () => {
    if (followRetryTimer.current) clearTimeout(followRetryTimer.current);
    followRetryTimer.current = null;
  };

  const finishFollowScroll = () => {
    if (followScrollTimer.current) clearTimeout(followScrollTimer.current);
    followScrollTimer.current = null;
    followScrollActive.current = false;
  };

  const beginFollowScroll = (target: string) => {
    finishFollowScroll();
    lastFollowTarget.current = target;
    followScrollActive.current = true;
    followScrollTimer.current = setTimeout(finishFollowScroll, 5_000);
  };

  const cancelFollowScroll = () => {
    if (!followScrollActive.current) return;
    finishFollowScroll();
    listRef.current?.scrollToOffset({
      offset: listOffset.current,
      animated: false,
    });
  };

  const clearFollowHolds = ({ cancelScroll = true }: { cancelScroll?: boolean } = {}) => {
    clearManualScrollTimer();
    clearFollowRetryTimer();
    if (cancelScroll) cancelFollowScroll();
    manualScrollActive.current = false;
    manualTouchActive.current = false;
    manualMomentumActive.current = false;
    userScrolledAt.current = 0;
    lastFollowTarget.current = null;
  };

  const jumpToHighlightedSequence = useCallback((sequenceNumber: number, animated = true) => {
    const idx = rowIndexBySeq.get(sequenceNumber) ?? -1;
    if (idx < 0) return;
    const target = `${route?.id ?? "none"}:${sequenceNumber}:${rows.length}`;
    try {
      beginFollowScroll(target);
      listRef.current?.scrollToIndex({
        index: idx,
        viewPosition: FOLLOW_VIEW_POSITION,
        animated,
      });
    } catch (_) {
      finishFollowScroll();
      /* list not ready */
    }
  }, [rowIndexBySeq, route?.id, rows.length]);

  const openSequence = useCallback((seq: Sequence) => {
    if (combined) {
      setSelected(null);
      router.push({
        pathname: "/(field)/route",
        params: { sequence: String(seq.seq) },
      });
      return;
    }
    setSelected(seq);
  }, [combined]);

  const toggleFollow = () => {
    const turningOn = !follow;
    const requestId = followToggleRequestId.current + 1;
    followToggleRequestId.current = requestId;
    clearFollowHolds();
    if (turningOn && status.nextSeqNum != null) {
      jumpToHighlightedSequence(status.nextSeqNum, false);
    }
    setFollow(turningOn);

    void requestFix().then((freshFix) => {
      if (
        followToggleRequestId.current !== requestId
        || !turningOn
        || !freshFix
        || !route
      ) {
        return;
      }
      // Only the sequence pair is read here, which carries no hysteresis, so
      // this stays a stateless read rather than disturbing the corridor state.
      const refreshedStatus = computeGpsStatus(freshFix, route);
      // The initial explicit Follow-on jump may still be active. Clearing it
      // with cancelFollowScroll() restores the old listOffset and undoes the
      // very scroll this refresh is meant to confirm.
      clearFollowHolds({ cancelScroll: false });
      if (refreshedStatus.nextSeqNum != null) {
        jumpToHighlightedSequence(refreshedStatus.nextSeqNum, false);
      }
    });
  };

  const finishManualScroll = () => {
    clearManualScrollTimer();
    if (!manualScrollActive.current) return;
    userScrolledAt.current = Date.now();
    manualScrollActive.current = false;
    manualTouchActive.current = false;
    manualMomentumActive.current = false;
  };

  const scheduleManualScrollEnd = () => {
    clearManualScrollTimer();
    if (
      !manualScrollActive.current
      || manualTouchActive.current
      || manualMomentumActive.current
    ) {
      return;
    }
    scrollEndTimer.current = setTimeout(
      finishManualScroll,
      MANUAL_SCROLL_SETTLE_MS,
    );
  };

  const beginManualScroll = () => {
    clearManualScrollTimer();
    lastFollowTarget.current = null;
    // Freeze at the latest rendered offset so a Follow animation that began
    // just before this touch cannot continue pulling against the gesture.
    cancelFollowScroll();
    manualScrollActive.current = true;
    manualTouchActive.current = true;
    manualMomentumActive.current = false;
  };

  const noteManualScrollActivity = () => {
    if (!manualScrollActive.current) return;
    userScrolledAt.current = Date.now();
    scheduleManualScrollEnd();
  };

  // Follow mode: auto-scroll to the nearest sequence as the GPS fix updates —
  // but not while the user is actively browsing (pause after a manual scroll).
  useEffect(() => {
    if (!follow || !fix || !route || status.nextSeqNum == null) return;
    if (manualScrollActive.current || isFollowAutoScrollPaused(userScrolledAt.current)) return;
    const idx = rowIndexBySeq.get(status.nextSeqNum) ?? -1;
    if (idx >= 0) {
      const target = `${route.id}:${status.nextSeqNum}:${rows.length}`;
      if (lastFollowTarget.current === target) return;
      try {
        beginFollowScroll(target);
        listRef.current?.scrollToIndex({ index: idx, viewPosition: FOLLOW_VIEW_POSITION, animated: true });
      } catch (_) {
        finishFollowScroll();
        /* list not ready */
      }
    }
  }, [fix, follow, route, rowIndexBySeq, rows.length, status.nextSeqNum]);

  const listEl = (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={(r) => (r.kind === "seq" ? `seq-${r.seq.seq}` : r.key)}
      style={styles.listFlex}
      contentContainerStyle={styles.list}
      scrollEventThrottle={32}
      ListHeaderComponent={
        <>
          {searchOpen ? (
            <SearchBar
              query={query}
              onChange={setQuery}
              onClose={() => {
                setQuery("");
                setSearchOpen(false);
              }}
            />
          ) : null}
          {parsedQuery.kind !== "empty" ? (
            <SearchResultsHeader
              activeMatches={activeSearchMatches}
              crossMatches={crossRouteMatches}
              isSeqQuery={parsedQuery.kind === "seq"}
              onSwitchRoute={switchToSearchResult}
            />
          ) : null}
        </>
      }
      onTouchStart={beginManualScroll}
      onTouchEnd={() => {
        if (!manualScrollActive.current) return;
        manualTouchActive.current = false;
        noteManualScrollActivity();
      }}
      onTouchCancel={() => {
        manualTouchActive.current = false;
        scheduleManualScrollEnd();
      }}
      onScrollBeginDrag={beginManualScroll}
      onScroll={(event) => {
        listOffset.current = event.nativeEvent.contentOffset.y;
        noteManualScrollActivity();
      }}
      onScrollEndDrag={() => {
        manualTouchActive.current = false;
        noteManualScrollActivity();
      }}
      onMomentumScrollBegin={() => {
        if (!manualScrollActive.current) return;
        manualMomentumActive.current = true;
        clearManualScrollTimer();
      }}
      onMomentumScrollEnd={() => {
        if (followScrollActive.current) {
          finishFollowScroll();
          return;
        }
        if (!manualScrollActive.current || !manualMomentumActive.current) {
          return;
        }
        manualMomentumActive.current = false;
        finishManualScroll();
      }}
      onScrollToIndexFailed={(info) => {
        if (
          manualScrollActive.current
          || isFollowAutoScrollPaused(userScrolledAt.current)
        ) {
          finishFollowScroll();
          return;
        }
        beginFollowScroll(`${route?.id ?? "none"}:${status.nextSeqNum ?? info.index}:${rows.length}`);
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
        clearFollowRetryTimer();
        followRetryTimer.current = setTimeout(() => {
          followRetryTimer.current = null;
          if (
            manualScrollActive.current
            || isFollowAutoScrollPaused(userScrolledAt.current)
          ) {
            finishFollowScroll();
            return;
          }
          try {
            listRef.current?.scrollToIndex({ index: info.index, viewPosition: FOLLOW_VIEW_POSITION, animated: true });
          } catch (_) {
            finishFollowScroll();
            /* give up */
          }
        }, 120);
      }}
      renderItem={({ item, index }) =>
        item.kind === "gap" ? (
          <GapRow miles={item.miles} />
        ) : (
          <SequenceCard
            seq={item.seq}
            prev={index >= 2 && rows[index - 2].kind === "seq" ? (rows[index - 2] as { seq: Sequence }).seq : undefined}
            onOpen={openSequence}
            isNext={status.nextSeqNum != null && item.seq.seq === status.nextSeqNum}
            blink={status.withinBlink}
            navProvider={settings.navProvider}
            driverMode={settings.driverMode}
          />
        )
      }
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]} onLayout={onRootLayout}>
      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !routeReady ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Loading route selection…</Text>
        </View>
      ) : needsRoute ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Choose a route</Text>
          <Text style={styles.emptyBody}>
            Pick the route your van is covering before opening the sequence list.
          </Text>
          <Pressable style={styles.emptyButton} onPress={() => setPickerOpen(true)}>
            <Text style={styles.emptyButtonText}>Choose route</Text>
          </Pressable>
        </View>
      ) : route ? (
        <>
          <Header
            route={route}
            onOpenPicker={() => setPickerOpen(true)}
            onOpenStatus={statusSheet.open}
            onOpenNotifications={notifications.openSheet}
            unreadNotifications={notifications.unreadCount}
            follow={follow}
            onToggleFollow={toggleFollow}
            wide={combined}
            landscape={isLandscapeTablet}
            status={status}
            appStatusLabel={statusSheet.status.label}
            appStatusPillStyle={statusSheet.pillStyle}
            onSearch={() => setSearchOpen(true)}
          />
          {/* The search input itself lives at the top of the list (ListHeaderComponent)
              so it stays right above the sequence rows it filters; this row is just
              the GPS panel + trigger on phone (tablet already has a search icon
              in the header pills). */}
          {!searchOpen && !combined ? <GpsRow status={status} onSearch={() => setSearchOpen(true)} /> : null}
          <Progress route={route} progress={status.progress} direction={status.direction} />
          {!isLandscapeTablet && status.nextSeqNum != null ? (
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {status.prevSeqNum != null ? (
                  <>
                    <Text style={styles.summaryPrev}>
                      Prev #{status.prevSeqNum} · {status.prevDistanceLabel}
                    </Text>
                    <Text style={styles.summarySep}>{"   |   "}</Text>
                  </>
                ) : null}
                <Text style={styles.summaryNext}>
                  Next #{status.nextSeqNum} · {status.nextDistanceLabel}
                </Text>
              </Text>
            </View>
          ) : null}
          {combined ? (
            /* The list and map panes keep this JSX order in BOTH orientations —
               rotation only swaps the container's flex direction. React
               reconciles children by position, so rendering them in a different
               order per orientation would tear down and rebuild the native
               Mapbox view on every rotation. `column-reverse` puts the map back
               on top in portrait without moving it in the tree. */
            <View style={[styles.split, !isLandscapeTablet && styles.splitVertical]}>
              <View
                style={[
                  styles.splitPane,
                  isLandscapeTablet ? styles.splitListLandscape : styles.splitListPortrait,
                ]}
              >
                {listEl}
              </View>
              <View
                style={[
                  styles.splitPane,
                  styles.splitMap,
                  isLandscapeTablet ? styles.splitMapLandscape : styles.splitMapPortrait,
                ]}
              >
                {isFocused ? (
                  <RouteMap
                    routes={data?.routes}
                    activeId={route.id}
                    nextSeqNum={status.nextSeqNum}
                    initialSequenceNumber={sequenceJump.sequenceNumber}
                    onInitialSequenceOpened={sequenceJump.consume}
                    cumberlandFarmsVisible={settings.cumberlandFarmsVisible}
                    onCumberlandFarmsVisibleChange={setCumberlandFarmsVisible}
                    mapType={settings.mapType}
                    navProvider={settings.navProvider}
                    vans={fleet}
                    selfVanId={vanId}
                    follow={follow}
                    onFollowChange={setFollow}
                  />
                ) : null}
              </View>
            </View>
          ) : (
            listEl
          )}
        </>
      ) : null}
      <DetailModal seq={selected} onClose={() => setSelected(null)} />
      <RoutePicker
        visible={pickerOpen}
        routes={data?.routes ?? []}
        activeId={route?.id ?? null}
        onSelect={setRouteId}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textMuted, fontSize: 15 },
  errorText: { color: colors.amber, fontSize: 14, paddingHorizontal: 24, textAlign: "center" },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  emptyBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 10, marginBottom: 14, paddingHorizontal: 24 },
  emptyButton: { backgroundColor: colors.brandRed, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12 },
  emptyButtonText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  // Topbar
  topbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg },
  topLogo: { width: 34, height: 34, borderRadius: 17 },
  routeCol: { flex: 1, minWidth: 0 },
  // `flex: 0` (or an unset flexBasis) resolved to 0 width here, so the route
  // name/logo silently disappeared on tablet. Give it an explicit width
  // (not just maxWidth) so it doesn't depend on content-based auto-sizing.
  routeColWide: { flexGrow: 0, flexShrink: 0, flexBasis: 200, width: 200 },
  headerGps: { flex: 1, minWidth: 0, alignSelf: "stretch", minHeight: 48 },
  headerGpsLandscape: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  gpsSequenceSide: { flex: 0.8, minWidth: 76, maxWidth: 112, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  gpsSequenceLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  gpsSequenceLabelPrevious: { color: colors.textMuted },
  gpsSequenceLabelNext: { color: colors.green },
  gpsSequenceNumber: { color: colors.text, fontSize: 16, fontWeight: "800", lineHeight: 18 },
  gpsSequenceDistance: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  routeName: { color: colors.text, fontSize: 21, fontWeight: "700", lineHeight: 21 },
  routeMeta: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  pills: { flexDirection: "row", alignItems: "center", gap: 6 },
  circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  notifBadge: { position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.brandRed, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.bg },
  notifBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  livePill: { borderRadius: 999, paddingHorizontal: 12, height: 38, maxWidth: 128, alignItems: "center", justifyContent: "center" },
  livePillText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  // GPS + search row
  gpsRow: { flexDirection: "row", alignItems: "stretch", minHeight: 56, backgroundColor: colors.bgElevated, borderBottomWidth: 1, borderBottomColor: colors.border },
  gpsPanel: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 8, borderRightWidth: 1, borderRightColor: colors.border },
  gpsLabel: { width: 24, textAlign: "center", textAlignVertical: "center", color: colors.brandRed, fontSize: 10, fontWeight: "600", borderRightWidth: 1, borderRightColor: colors.border, paddingTop: 20 },
  gpsMeta: { justifyContent: "center", gap: 4, paddingHorizontal: 6 },
  gpsK: { fontSize: 9, color: colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.4 },
  gpsV: { fontSize: 12, fontWeight: "600", color: colors.text },
  gpsStatus: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, marginVertical: 6, marginRight: 6, backgroundColor: colors.routeOffBg },
  gpsStatusLabel: { color: colors.textSubtle, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  searchBtn: { width: 56, alignItems: "center", justifyContent: "center" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, paddingHorizontal: 12, backgroundColor: colors.bgElevated, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 8 },
  searchResultsHeader: { marginHorizontal: 10, marginBottom: 10, gap: 8 },
  crossRouteHint: { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 10 },
  crossRouteLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  crossRouteButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  crossRouteButton: { backgroundColor: colors.bgControl, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  crossRouteButtonText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  noMatches: { color: colors.textMuted, fontSize: 14, textAlign: "center", paddingVertical: 10 },

  // Route progress
  progress: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  progressEnd: { color: colors.textSubtle, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  progressTrack: { flex: 1, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)", position: "relative", justifyContent: "center" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: colors.brandRed },
  progressMarker: { position: "absolute", top: -8, marginLeft: -10, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandRed, borderWidth: 2, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },

  // Next / prev summary bar
  summary: { minHeight: 40, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 7, paddingHorizontal: 12 },
  summaryText: { textAlign: "center" },
  summaryNext: { color: "#fff", fontSize: 18, fontWeight: "800" },
  summarySep: { color: colors.borderStrong, fontSize: 18, fontWeight: "700" },
  summaryPrev: { color: colors.textMuted, fontSize: 18, fontWeight: "800" },

  // Tablet Route workspace: 30/70 columns in landscape, 70/30 stacked panels in portrait.
  split: { flex: 1, flexDirection: "row" },
  // column-reverse, not column: the panes render list-then-map in both
  // orientations (see the split render), so portrait reverses the axis to put
  // the map back on top with the list beneath it.
  splitVertical: { flexDirection: "column-reverse" },
  splitPane: { flex: 1, minWidth: 0 },
  splitMap: { borderLeftWidth: 1, borderLeftColor: colors.border },
  splitListLandscape: { flex: 0.3, maxWidth: "30%" },
  splitMapLandscape: { flex: 0.7, maxWidth: "70%" },
  splitMapPortrait: { flex: 0.7, minHeight: 0, borderLeftWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  splitListPortrait: { flex: 0.3, minHeight: 0 },

  // Sequence list
  listFlex: { flex: 1 },
  list: { paddingVertical: 10, paddingBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: "transparent", borderRadius: 16, marginHorizontal: 10, marginBottom: 10, overflow: "hidden" },
  nextOutline: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: colors.brandRed, borderRadius: 16 },
  nextRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.brandRed },
  num: { width: 64, alignItems: "center", justifyContent: "center", gap: 6 },
  dir: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  numMain: { color: "#fff", fontSize: 24, fontWeight: "800", lineHeight: 24 },
  numMainLg: { fontSize: 30, lineHeight: 30 },
  mileTotal: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  body: { flex: 1, minWidth: 0 },
  townLine: { color: colors.textMuted, fontSize: 12, marginBottom: 1 },
  townEntry: { color: colors.brandRed, fontSize: 9 },
  streetLine: { color: colors.text, fontSize: 17, fontWeight: "700" },
  streetLineLg: { fontSize: 21 },
  times: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  timesText: { color: colors.textMuted, fontSize: 12 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  badge: { color: "#fff", fontSize: 10, fontWeight: "600", letterSpacing: 0.4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  nav: { width: 38, height: 38, borderRadius: 8, borderWidth: 1.5, borderColor: colors.brandRed, alignItems: "center", justifyContent: "center" },

  // Gap row (distance-to-next) — no card background, just the marker + distance.
  gap: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28, marginHorizontal: 22, marginBottom: 10, paddingVertical: 2 },
  gapMarker: { color: colors.textMuted, fontSize: 13 },
  gapDistance: { color: colors.textMuted, fontSize: 14, fontWeight: "700" },

  // Sequence detail modal
  modalContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  modalAddr: { color: colors.textMuted, fontSize: 14 },
  modalDetails: { marginTop: 14, gap: 7 },
  modalDetailRow: { flexDirection: "row", justifyContent: "space-between", gap: 16 },
  modalDetailK: { color: colors.textSubtle, fontSize: 13 },
  modalDetailV: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
  modalActions: { gap: 8, marginTop: 16 },
  modalBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.brandRed, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16 },
  modalBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
