import { useCallback, useEffect, useState } from "react";
import { useIsFocused } from "expo-router";
import { FontAwesome6 } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@road-crew/ui";
import { NEW_MAP_FOLLOW } from "@road-crew/config";
import { getRouteById } from "@road-crew/data";
import { useRoutes } from "@/field/useRoutes";
import { useSharedGeolocation } from "@/field/Geolocation";
import { useGpsStatus } from "@/field/useGpsStatus";
import { GpsPanel } from "@/field/GpsPanel";
import { useSelectedRoute } from "@/field/RouteSelection";
import { RoutePicker } from "@/field/RoutePicker";
import { useStatusSheet } from "@/field/StatusSheet";
import { useSettings } from "@/field/Settings";
import { useNotifications } from "@/notifications/NotificationsProvider";
import { useSession } from "@/auth/SessionProvider";
import { pressFeedback } from "@/ui/pressFeedback";
import { useFleet } from "@/field/useFleet";
import { useSequenceJumpRequest } from "@/field/useSequenceJumpRequest";
import { useKeepAwakeWhen } from "@/field/useKeepAwakeWhen";
import RouteMap from "@/field/RouteMap";

const logo = require("../../public/icons/road-crew-logo.png");

export default function MapScreen() {
  const { data, error } = useRoutes();
  const { routeId, ready: routeReady, setRouteId } = useSelectedRoute();
  const route = data && routeId ? (getRouteById(data, routeId) ?? undefined) : undefined;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  // The map is the screen a driver leaves open on a mount for a whole shift, so
  // it holds the wake lock only when the new map-follow interaction is enabled.
  useKeepAwakeWhen(NEW_MAP_FOLLOW);
  const statusSheet = useStatusSheet();
  const notifications = useNotifications();
  const { settings, update: updateSettings } = useSettings();
  const { vanId } = useSession();
  const { fix } = useSharedGeolocation();
  const sequenceJump = useSequenceJumpRequest();
  const setCumberlandFarmsVisible = useCallback((visible: boolean) => {
    updateSettings({ cumberlandFarmsVisible: visible });
  }, [updateSettings]);
  const status = useGpsStatus(fix, route);
  // Only mount the expensive map while the Map tab is focused, so it
  // doesn't keep rendering in the background and slow the whole app.
  const isFocused = useIsFocused();
  // Poll the fleet only while the Map tab is focused (everyone sees the fleet).
  const fleet = useFleet(isFocused);
  const needsRoute = Boolean(data && routeReady && !route);

  useEffect(() => {
    if (needsRoute) setPickerOpen(true);
  }, [needsRoute]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topbar}>
        <Image source={logo} style={styles.topLogo} accessibilityLabel="Road Crew logo" />
        <Pressable
          style={({ pressed }) => [styles.routeCol, pressed && pressFeedback.activeSubtle]}
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change route"
        >
          <Text style={styles.routeName} numberOfLines={1}>
            {route?.name || "Map"}
          </Text>
          {route ? (
            <Text style={styles.routeMeta}>
              Day {route.day} · {route.sequence_count ?? route.sequences.length} seqs · {route.official_miles} mi
            </Text>
          ) : null}
        </Pressable>
        <View style={styles.pills}>
          {NEW_MAP_FOLLOW ? (
            <Pressable
              style={({ pressed }) => [
                styles.circleBtn,
                { backgroundColor: follow ? colors.brandRedDark : "#5b5b63" },
                pressed && pressFeedback.active,
              ]}
              onPress={() => setFollow((on) => !on)}
              accessibilityRole="button"
              accessibilityState={{ selected: follow }}
              accessibilityLabel="Toggle follow"
            >
              <FontAwesome6 name="location-crosshairs" size={16} color="#fff" />
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.circleBtn,
              { backgroundColor: follow ? colors.brandRedDark : "#5b5b63" },
              pressed && pressFeedback.active,
            ]}
            onPress={() => setFollow((on) => !on)}
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
            onPress={notifications.openSheet}
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
          >
            <FontAwesome6 name="bell" size={16} color="#fff" />
            {notifications.unreadCount > 0 ? (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{notifications.unreadCount > 9 ? "9+" : notifications.unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.livePill, statusSheet.pillStyle, pressed && pressFeedback.active]}
            onPress={statusSheet.open}
            accessibilityRole="button"
            accessibilityLabel={`Open status: ${statusSheet.status.label}`}
          >
            <Text style={styles.livePillText} numberOfLines={1}>{statusSheet.status.label} ›</Text>
          </Pressable>
        </View>
      </View>

      {/* GPS panel (no search on the map, matching the legacy layout) */}
      <View style={styles.gpsRow}>
        <GpsPanel status={status} />
      </View>

      <View style={styles.mapWrap}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !routeReady ? (
          <Text style={styles.error}>Loading route selection…</Text>
        ) : needsRoute ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Choose a route</Text>
            <Text style={styles.emptyBody}>
              Pick the route your van is covering before opening the map.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.emptyButton, pressed && pressFeedback.active]}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={styles.emptyButtonText}>Choose route</Text>
            </Pressable>
          </View>
        ) : isFocused ? (
          <RouteMap
            routes={data?.routes}
            activeId={route?.id}
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
  topbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg },
  topLogo: { width: 34, height: 34, borderRadius: 17 },
  routeCol: { flex: 1, minWidth: 0 },
  routeName: { color: colors.text, fontSize: 21, fontWeight: "700", lineHeight: 21 },
  routeMeta: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  pills: { flexDirection: "row", alignItems: "center", gap: 6 },
  circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  notifBadge: { position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.brandRed, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.bg },
  notifBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  livePill: { borderRadius: 999, paddingHorizontal: 12, height: 38, maxWidth: 128, alignItems: "center", justifyContent: "center" },
  livePillText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  gpsRow: { flexDirection: "row", alignItems: "stretch", gap: 8, minHeight: 56, backgroundColor: colors.bgElevated, borderBottomWidth: 1, borderBottomColor: colors.border },
  gpsLabel: { width: 24, textAlign: "center", color: colors.brandRed, fontSize: 10, fontWeight: "600", borderRightWidth: 1, borderRightColor: colors.border, paddingTop: 20 },
  gpsMeta: { justifyContent: "center", gap: 4, paddingHorizontal: 6 },
  gpsK: { fontSize: 9, color: colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.4 },
  gpsV: { fontSize: 12, fontWeight: "600", color: colors.text },
  gpsStatus: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, marginVertical: 6, marginRight: 6, backgroundColor: colors.routeOffBg },
  gpsStatusLabel: { color: colors.textSubtle, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },

  mapWrap: { flex: 1, position: "relative" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 28 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  emptyBody: { color: colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyButton: { backgroundColor: colors.brandRed, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, marginTop: 2 },
  emptyButtonText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  error: { color: colors.amber, fontSize: 14, padding: 24, textAlign: "center" },
});
