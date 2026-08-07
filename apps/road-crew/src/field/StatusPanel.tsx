import { useEffect, useRef, useState } from "react";
import { FontAwesome6 } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import { Alert, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@road-crew/ui";
import { APP_VERSION, APP_CONFIG } from "@road-crew/config";
import { formatRelative, nearestSequences } from "@road-crew/core";
import { getDeviceId } from "@/device/deviceId";
import { resetApp, updateApp, OfflineError } from "@/update/appUpdate";
import { getLastRefreshedAt } from "@/update/lastRefreshed";
import { exportDiagnostics } from "@/update/diagnostics";
import { captureError } from "@/monitoring";
import { pressFeedback } from "@/ui/pressFeedback";
import { useSession } from "@/auth/SessionProvider";
import { acquirePushTokens } from "@/push/registration";
import { getPushRegistrationDiagnostics } from "@/push/diagnostics";
import { readBackgroundNotificationEvents } from "@/push/backgroundNotification";
import { apiUrl } from "@/api/client";
import { CONFIG } from "@/config";
import { useSettings, type NavProvider, type MapType } from "./Settings.tsx";
import { useHeartbeat } from "@/update/HeartbeatProvider";
import { shouldUseNativeAnimationDriver } from "@/ui/animationDriver";
import { shouldShowTrackingControl } from "./trackingPolicy.ts";
import type { StatusState } from "./useStatusState.ts";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <View>
      <View style={styles.control}>
        <Text style={styles.controlLabel}>{label}</Text>
        <Pressable
          style={({ pressed }) => [styles.select, pressed && pressFeedback.active]}
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
        >
          <Text style={styles.selectText}>{current}</Text>
          <FontAwesome6 name={open ? "chevron-up" : "chevron-down"} size={11} color={colors.textMuted} />
        </Pressable>
      </View>
      {open ? (
        <View style={styles.menu}>
          {options.map((o) => (
            <Pressable
              key={o.value}
              style={({ pressed }) => [styles.menuItem, pressed && pressFeedback.activeSubtle]}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <Text style={[styles.menuItemText, o.value === value && styles.menuItemActive]}>{o.label}</Text>
              {o.value === value ? <FontAwesome6 name="check" size={13} color={colors.brandRed} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Check({
  label,
  hint,
  value,
  onToggle,
  disabled = false,
}: {
  label: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.check, pressed && !disabled && pressFeedback.activeSubtle, disabled && styles.disabled]}
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
    >
      <View style={[styles.box, value && styles.boxOn]}>{value ? <FontAwesome6 name="check" size={11} color="#fff" /> : null}</View>
      <Text style={styles.checkLabel}>
        {label} <Text style={styles.checkHint}>({hint})</Text>
      </Text>
    </Pressable>
  );
}

const CONFIRM_TIMEOUT_MS = 3000;

/**
 * Two-tap confirm, matching legacy's makeAppClearHandler: the first tap arms
 * a 3s "Tap again to confirm" window; the second tap (while still armed)
 * actually runs the action. Blocks with a flashed "Offline — connect first"
 * message if the device is offline, either at the first or second tap.
 */
function ConfirmButton({
  label,
  style,
  onConfirm,
}: {
  label: string;
  style: StyleProp<ViewStyle>;
  onConfirm: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "confirming" | "working" | "offline">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Pulse the amber "armed" background while waiting for the confirming tap —
  // draws the eye back to the button instead of a silent countdown.
  useEffect(() => {
    if (state === "confirming") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 0.4,
            duration: 450,
            useNativeDriver: shouldUseNativeAnimationDriver(Platform.OS),
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 450,
            useNativeDriver: shouldUseNativeAnimationDriver(Platform.OS),
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(1);
  }, [state, pulse]);

  const arm = (next: "confirming" | "offline") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(next);
    timerRef.current = setTimeout(() => setState("idle"), CONFIRM_TIMEOUT_MS);
  };

  const handlePress = async () => {
    if (state === "working") return;
    if (state !== "confirming") {
      arm("confirming");
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setState("working");
    try {
      await onConfirm();
      // On success the page reloads (web) — no further state update needed.
    } catch (error) {
      if (error instanceof OfflineError) {
        arm("offline");
      } else {
        captureError(error, { tags: { source: "app_clear_handler" } });
        setState("idle");
      }
    }
  };

  const text =
    state === "offline" ? "Offline — connect first"
    : state === "confirming" ? "Tap again to confirm"
    : state === "working" ? "Clearing…"
    : label;

  return (
    <Pressable
      style={({ pressed }) => [style, styles.btnClip, state === "offline" && styles.btnOffline, pressed && pressFeedback.active]}
      onPress={handlePress}
      disabled={state === "working"}
      accessibilityRole="button"
    >
      {state === "confirming" ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.btnConfirmingOverlay, { opacity: pulse }]} />
      ) : null}
      <Text style={styles.btnText}>{text}</Text>
    </Pressable>
  );
}

/**
 * App status, settings and recovery actions — the diagnostics half of the
 * location modal, reached from the badge in its header. `visible` is the
 * modal's own visibility, used to re-read values that a just-finished
 * Update/Reset would have changed.
 */
export function StatusPanel({
  visible,
  onClose,
  statusState,
}: {
  visible: boolean;
  onClose: () => void;
  statusState: StatusState;
}) {
  const { settings, update } = useSettings();
  const {
    vanId,
    vanInstallConfigured,
    vanInstallSkipped,
    reportingVan,
    remoteTrackingEnabled,
    locationTrackingAllowed,
    setVanInstallMode,
    signOut,
  } = useSession();
  const { setTrackingEnabled } = useHeartbeat();
  const [deviceId, setDeviceId] = useState("Loading...");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [savingInstallMode, setSavingInstallMode] = useState(false);
  const canConfigureVanInstall = CONFIG.vanInstallEnabled;
  const {
    nowMs,
    online,
    fix,
    route,
    updatedMs,
    validationIssues,
    issues,
    locationReporting,
    locationReportStatus,
    locationLastAttemptAt,
    locationLastSuccessAt,
    lastHeartbeatAt,
    locationLastError,
    vanInstall,
    gpsError,
  } = statusState;

  useEffect(() => {
    let cancelled = false;
    getDeviceId()
      .then((id) => {
        if (!cancelled) setDeviceId(id);
      })
      .catch(() => {
        if (!cancelled) setDeviceId("Unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getLastRefreshedAt().then((ms) => {
      if (!cancelled) setLastRefreshedAt(ms);
    });
    return () => {
      cancelled = true;
    };
    // Re-read whenever the sheet opens, so a just-completed Update/Reset shows up.
  }, [visible]);

  const handleExportDiagnostics = () => {
    const nearest = fix && route
      ? (() => {
          const pair = nearestSequences(route.sequences, fix.lat, fix.lng, { heading: fix.heading });
          if (!pair) return null;
          return {
            previous: { seq: pair.previous.seq.seq, distanceM: Math.round(pair.previous.distance) },
            next: { seq: pair.next.seq.seq, distanceM: Math.round(pair.next.distance) },
          };
        })()
      : null;
    void Promise.all([
      getPushRegistrationDiagnostics(),
      readBackgroundNotificationEvents(),
    ]).then(([push, backgroundNotificationEvents]) => exportDiagnostics({
      deviceId,
      platform: Platform.OS,
      runtimeOrigin: Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null,
      apiBaseUrl: CONFIG.apiBaseUrl,
      heartbeatEndpoint: apiUrl(CONFIG.heartbeatPath),
      locationsEndpoint: apiUrl(CONFIG.locationsPath),
      buildVanInstall: CONFIG.vanInstallEnabled,
      vanId,
      vanInstall,
      vanInstallConfigured,
      vanInstallSkipped,
      reportingVan,
      // The flag that decides whether background location runs at all. Without
      // it an export can only imply tracking state from side effects.
      remoteTrackingEnabled,
      locationTrackingAllowed,
      locationReporting,
      locationReportStatus,
      locationLastAttemptAt,
      locationLastSuccessAt,
      locationLastError,
      online,
      gpsError,
      routeId: route?.id ?? null,
      routeName: route?.name ?? null,
      dataGeneratedAtMs: updatedMs || null,
      validationIssues,
      resetAt: lastRefreshedAt,
      mapProvider: settings.mapType,
      navProvider: settings.navProvider,
      driverMode: settings.driverMode,
      fix,
      nearest,
      push,
      backgroundNotificationEvents,
    })).catch((error) => {
      captureError(error, { tags: { source: "export_diagnostics" } });
    });
  };

  // The "Tracked" switch is the shared tracking control. For a device that is
  // not yet a van install it enters setup; for one that is, it pauses/resumes
  // background location reporting (the same flag Command can toggle) without
  // leaving van-install mode. Foreground heartbeats still include the current
  // fix. Fully leaving van-install is done via Change van / Reset.
  const handleToggleTracked = async () => {
    if (!shouldShowTrackingControl(canConfigureVanInstall, locationTrackingAllowed) || savingInstallMode) return;
    setSavingInstallMode(true);
    try {
      if (!vanInstall) {
        await setVanInstallMode(true);
        await setTrackingEnabled(true);
        if (!vanId) {
          onClose();
          router.replace("/van-install");
        }
      } else {
        await setTrackingEnabled(!remoteTrackingEnabled);
      }
    } catch (error) {
      captureError(error, {
        tags: { source: "status_sheet_tracking_toggle" },
        extra: { vanInstall, remoteTrackingEnabled, hasVanId: Boolean(vanId) },
      });
      Alert.alert("Couldn't change tracking", "The app couldn't save the tracking setting. Try again.");
    } finally {
      setSavingInstallMode(false);
    }
  };

  const handleChangeVan = async () => {
    if (!canConfigureVanInstall) return;
    try {
      await signOut();
      onClose();
      router.replace(vanInstall ? "/van-install" : "/sign-in");
    } catch (error) {
      captureError(error, { tags: { source: "status_sheet_change_van" }, extra: { vanId } });
      Alert.alert("Couldn't change van", "The app couldn't clear the saved van selection. Try again.");
    }
  };

  const handleResetApp = async () => {
    const shouldOpenVanInstall = canConfigureVanInstall
      && Boolean(vanInstall || !vanInstallConfigured);
    await resetApp({ redirectPath: shouldOpenVanInstall ? "/" : null });
    if (shouldOpenVanInstall && Platform.OS !== "web") {
      await signOut();
      onClose();
      router.replace("/");
    }
  };

  const handlePushSetup = async () => {
    const tokens = await acquirePushTokens("status-sheet");
    const granted = Boolean(tokens.expoPushToken || tokens.devicePushToken);
    Alert.alert(
      granted ? "Push ready" : "Push unavailable",
      granted
        ? "This device can receive silent Command sync wakes."
        : "A native push token is unavailable. Check this on a physical iOS device.",
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.section}>
        <Row label="Network" value={online ? "Online" : "Offline"} />
        <Row label="Last ping" value={lastHeartbeatAt ? formatRelative(lastHeartbeatAt, nowMs) : "never"} />
        <Row label="GPS fix" value={fix ? formatRelative(fix.ts, nowMs) : "never"} />
        <Row label="Accuracy" value={fix?.accuracy != null ? `±${Math.round(fix.accuracy)} m` : "—"} />
        <Row label="Lat / Lng" value={fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : "—"} />
        <Row label="Route data updated" value={updatedMs ? formatRelative(updatedMs, nowMs) : "—"} />
        <Row label="Data integrity" value={issues ? `${issues} issue${issues > 1 ? "s" : ""}` : "OK"} />
        <Row label="App last reset" value={lastRefreshedAt ? formatRelative(lastRefreshedAt, nowMs) : "—"} />
        <Row label="App version" value={APP_VERSION.release} />
        <Row label="Build" value={Updates.channel ? `${APP_VERSION.build} · ${Updates.channel}` : APP_VERSION.build} />
        <Row label="Device ID" value={deviceId} />
      </View>

      <Select
        label="Default navigation"
        value={settings.navProvider}
        options={APP_CONFIG.navProviders.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(v) => update({ navProvider: v as NavProvider })}
      />
      <Select
        label="Map type"
        value={settings.mapType}
        options={APP_CONFIG.mapProviders.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(v) => update({ mapType: v as MapType })}
      />

      <View style={styles.checks}>
        {shouldShowTrackingControl(canConfigureVanInstall, locationTrackingAllowed) ? (
          <Check
            label="Tracked"
            hint="keeps reporting in the background; foreground check-ins still include GPS"
            value={vanInstall && remoteTrackingEnabled}
            onToggle={handleToggleTracked}
            disabled={savingInstallMode}
          />
        ) : null}
        <Check label="Driver mode" hint="larger text while driving" value={settings.driverMode} onToggle={() => update({ driverMode: !settings.driverMode })} />
      </View>

      <View style={styles.buttonsRow}>
        {canConfigureVanInstall ? (
          <Pressable
            style={({ pressed }) => [styles.btnDark, pressed && pressFeedback.active]}
            onPress={handleChangeVan}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>Change van</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.btnDark, pressed && pressFeedback.active]}
          onPress={handlePushSetup}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Check push setup</Text>
        </Pressable>
      </View>

      <View style={styles.buttonsRow}>
        <ConfirmButton
          label="Update App"
          style={styles.btnDark}
          onConfirm={async () => {
            await updateApp();
          }}
        />
        <ConfirmButton label="Reset App" style={styles.btnRed} onConfirm={handleResetApp} />
      </View>
      <Pressable
        style={({ pressed }) => [styles.btnWide, pressed && pressFeedback.active]}
        onPress={handleExportDiagnostics}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>Export diagnostics</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40, gap: 12 },
  section: { gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 16 },
  rowLabel: { color: colors.textMuted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },

  control: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  controlLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  select: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgControl, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  selectText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  menu: { marginTop: 6, backgroundColor: colors.bgControl, borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  menuItemText: { color: colors.text, fontSize: 15 },
  menuItemActive: { color: colors.brandRed, fontWeight: "700" },

  checks: { gap: 12, marginTop: 6 },
  check: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: colors.brandRed, borderColor: colors.brandRed },
  checkLabel: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1 },
  checkHint: { color: colors.textMuted, fontWeight: "400" },
  disabled: { opacity: 0.65 },

  buttonsRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  btnDark: { flex: 1, backgroundColor: colors.bgControl, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  btnRed: { flex: 1, backgroundColor: colors.brandRed, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  btnWide: { backgroundColor: colors.bgControl, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  btnOffline: { backgroundColor: colors.amber },
  btnClip: { overflow: "hidden" },
  btnConfirmingOverlay: { backgroundColor: colors.amber },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
