import { useEffect, useState } from "react";
import { FontAwesome6 } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@road-crew/ui";
import { useSession } from "@/auth/SessionProvider";
import { useStatusSheet } from "@/field/StatusSheet";
import { useRoutes } from "@/field/useRoutes";
import { useSelectedRoute } from "@/field/RouteSelection";
import { RoutePicker } from "@/field/RoutePicker";
import { showRouteChangedToast } from "@/field/RouteChangedToast";
import { useTabletRouteWorkspace } from "@/field/useTabletRouteWorkspace";
import { pressFeedback } from "@/ui/pressFeedback";
import { useNotifications } from "@/notifications/NotificationsProvider";

const logo = require("../../public/icons/road-crew-logo.png");

const CUMBYS_URL = "https://apps.apple.com/us/app/smartpay-business/id891071083";
const HQ_TEL = "tel:18009329253";

function openExternalUrl(url: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.assign(url);
    return;
  }
  Linking.openURL(url);
}

type Tile = {
  key: string;
  icon: React.ComponentProps<typeof FontAwesome6>["name"];
  title: string;
  onPress: () => void;
};

// Mirrors the legacy home tiles (app/index.html #home). Command is opt-in and
// omitted from v1; Follow/Update tiles were already commented out in the PWA.
const TILES: Tile[] = [
  { key: "sequences", icon: "route", title: "Sequences", onPress: () => router.push("/(field)/sequences") },
  { key: "map", icon: "compass", title: "Map", onPress: () => router.push("/(field)/map") },
  // Change route opens the route picker; its onPress is wired in the component.
  { key: "changeroute", icon: "shuffle", title: "Change route", onPress: () => {} },
  // Change map opens the settings half of the location modal, where the map
  // type lives; its onPress is wired in the component.
  { key: "changemap", icon: "layer-group", title: "Change map", onPress: () => {} },
  { key: "cumbys", icon: "gas-pump", title: "Cumbys", onPress: () => openExternalUrl(CUMBYS_URL) },
  { key: "callhq", icon: "phone", title: "Call HQ", onPress: () => Linking.openURL(HQ_TEL) },
  // Where am I? opens the location popover (app status sits behind its badge);
  // its onPress is wired in the component.
  { key: "whereami", icon: "location-dot", title: "Where am I?", onPress: () => {} },
];

const A2HS_KEY = "rc-a2hs-dismissed";

// iOS doesn't fire `beforeinstallprompt`, so the manual "Tap Share, then Add to
// Home Screen" instructions only make sense there (matches legacy app/js/a2hs.js).
function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) && !/Android/.test(ua);
}

/** Web-only "Add to Home Screen" hint, dismissible + hidden once installed. */
function useInstallBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (!isIOSSafari()) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(A2HS_KEY) === "1";
    } catch (_) {
      /* storage blocked */
    }
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (!dismissed && !standalone) setShow(true);
  }, []);
  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(A2HS_KEY, "1");
    } catch (_) {
      /* storage blocked */
    }
  };
  return { show, dismiss };
}

function InstallBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View style={styles.install}>
      <View style={styles.installIcon}>
        <FontAwesome6 name="arrow-up-from-bracket" size={16} color={colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.installTitle}>Install Road Crew</Text>
        <Text style={styles.installBody}>
          Tap Share, then <Text style={styles.installHi}>Add to Home Screen</Text> for full-screen offline use.
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => (pressed ? pressFeedback.activeSubtle : null)}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss install hint"
        hitSlop={8}
      >
        <FontAwesome6 name="xmark" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function HomeTile({ tile }: { tile: Tile }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && pressFeedback.active]}
      onPress={tile.onPress}
      accessibilityRole="button"
    >
      <View style={styles.tileIcon}>
        <FontAwesome6 name={tile.icon} size={24} color="#fff" />
      </View>
      <Text style={styles.tileTitle}>{tile.title}</Text>
    </Pressable>
  );
}

function SequenceJump({ value, onChange, onSubmit, error }: { value: string; onChange: (value: string) => void; onSubmit: () => void; error: string | null }) {
  return (
    <View style={styles.jumpSection}>
      <Text style={styles.jumpLabel}>Jump to sequence</Text>
      <View style={styles.jumpRow}>
        <FontAwesome6 name="route" size={15} color={colors.textSubtle} />
        <TextInput
          style={styles.jumpInput}
          value={value}
          onChangeText={onChange}
          placeholder="Seq #"
          placeholderTextColor={colors.textSubtle}
          inputMode="numeric"
          keyboardType="number-pad"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          accessibilityLabel="Sequence number"
        />
        <Pressable
          style={({ pressed }) => [styles.jumpButton, pressed && pressFeedback.active]}
          onPress={onSubmit}
          accessibilityRole="button"
          accessibilityLabel="Open sequence on map"
        >
          <FontAwesome6 name="arrow-right" size={14} color="#fff" />
        </Pressable>
      </View>
      {error ? <Text style={styles.jumpError}>{error}</Text> : null}
    </View>
  );
}

// On tablet/wide screens the list + map share one screen, so the Sequences and
// Map tiles condense into a single "Route" tile.
const ROUTE_TILE: Tile = {
  key: "route",
  icon: "route",
  title: "Route",
  onPress: () => router.push("/(field)/route"),
};

export default function HomeScreen() {
  const banner = useInstallBanner();
  const status = useStatusSheet();
  const { vanId } = useSession();
  const { data: routeData } = useRoutes();
  const { routeId, setRouteId } = useSelectedRoute();
  const [sequenceNumber, setSequenceNumber] = useState("");
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const isTablet = useTabletRouteWorkspace();
  const notifications = useNotifications();
  const baseTiles = isTablet
    ? [ROUTE_TILE, ...TILES.filter((t) => t.key !== "sequences" && t.key !== "map")]
    : TILES;
  const tiles = baseTiles.map((t) => {
    if (t.key === "whereami") return { ...t, onPress: status.open };
    if (t.key === "changemap") return { ...t, onPress: status.openSettings };
    if (t.key === "changeroute") return { ...t, onPress: () => setRoutePickerOpen(true) };
    return t;
  });
  const selectRouteFromPicker = async (id: string) => {
    if (id !== routeId) {
      await setRouteId(id);
      const picked = routeData?.routes.find((route) => route.id === id);
      showRouteChangedToast(picked?.name || id);
      // A route change is why the driver opened the picker; land them on the
      // screen that shows it instead of leaving them on Home to tap again.
      // Same split the tablet workspace uses everywhere else: one combined
      // view there, Map alone on a phone (Sequences stays a separate tap).
      router.push(isTablet ? "/(field)/route" : "/(field)/map");
    }
  };
  const jumpToSequence = async () => {
    const parsed = Number.parseInt(sequenceNumber.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setSequenceError("Enter a sequence number first.");
      return;
    }
    if (!routeData) {
      setSequenceError("Routes are still loading.");
      return;
    }
    const activeRoute = routeData.routes.find((route) => route.id === routeId);
    const targetRoute = (activeRoute?.sequences.some((sequence) => sequence.seq === parsed) ? activeRoute : null)
      ?? routeData.routes.find((route) => route.sequences.some((sequence) => sequence.seq === parsed));
    if (!targetRoute) {
      setSequenceError(`Sequence ${parsed} was not found.`);
      return;
    }
    setSequenceError(null);
    if (targetRoute.id !== routeId) {
      await setRouteId(targetRoute.id);
      showRouteChangedToast(targetRoute.name || targetRoute.id);
    }
    setSequenceNumber("");
    router.push({
      pathname: isTablet ? "/(field)/route" : "/(field)/map",
      params: { sequence: String(parsed) },
    });
  };
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <Image source={logo} style={styles.logo} accessibilityLabel="Road Crew logo" />
          <View>
            <Text style={styles.brandTitle}>Road Crew</Text>
            <Text style={styles.brandSubtitle}>Field Guide</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.bell, pressed && pressFeedback.active]}
            onPress={notifications.openSheet}
            accessibilityRole="button"
            accessibilityLabel={notifications.unreadCount ? `Open notifications, ${notifications.unreadCount} unread` : "Open notifications"}
          >
            <FontAwesome6 name="bell" size={16} color={colors.text} />
            {notifications.unreadCount > 0 ? (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{notifications.unreadCount > 9 ? "9+" : notifications.unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <View style={styles.grid}>
          {tiles.map((tile) => <HomeTile key={tile.key} tile={tile} />)}
        </View>

        <SequenceJump
          value={sequenceNumber}
          onChange={(value) => {
            setSequenceNumber(value.replace(/\D/g, ""));
            if (sequenceError) setSequenceError(null);
          }}
          onSubmit={() => void jumpToSequence()}
          error={sequenceError}
        />

        {vanId ? <Text style={styles.vanIdText}>{vanId}</Text> : null}

        {banner.show ? <InstallBanner onDismiss={banner.dismiss} /> : null}
      </ScrollView>

      <RoutePicker
        visible={routePickerOpen}
        routes={routeData?.routes ?? []}
        activeId={routeId}
        onSelect={(id) => void selectRouteFromPicker(id)}
        onClose={() => setRoutePickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  jumpSection: {
    width: "50%",
    maxWidth: 360,
    minHeight: 112,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "stretch",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 10,
    gap: 8,
  },
  jumpLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "700", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.2 },
  jumpRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 38, paddingLeft: 8, paddingRight: 4, backgroundColor: colors.bgControl, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  jumpInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 4 },
  jumpButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.brandRed },
  jumpError: { color: colors.amber, fontSize: 12, marginTop: 5 },
  // .home-brand
  brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  // .app-logo-home (circular, per the PWA's ringed logo)
  logo: { width: 54, height: 54, borderRadius: 27 },
  // .home-brand-title
  brandTitle: { color: colors.brandRed, fontSize: 23, fontWeight: "800", lineHeight: 23 },
  // .home-brand-subtitle
  brandSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    textTransform: "uppercase",
  },
  // .home-brand-bell / .pill-bell
  bell: {
    marginLeft: "auto",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bgControl,
    alignItems: "center",
    justifyContent: "center",
  },
  notifBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.brandRed,
    alignItems: "center",
    justifyContent: "center",
  },
  notifBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  // .home-grid (2 columns, 10px gap)
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  vanIdText: {
    marginTop: 16,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  // .home-tile
  tile: {
    width: "48.7%",
    minHeight: 112,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  // .home-tile-icon
  tileIcon: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.brandRed,
    alignItems: "center",
    justifyContent: "center",
  },
  // .home-tile-title
  tileTitle: { color: "#fff", fontSize: 15, fontWeight: "700", lineHeight: 17, textAlign: "center" },

  // Install (a2hs) banner
  install: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, padding: 14, borderRadius: 12, backgroundColor: "#16233b", borderWidth: 1, borderColor: "#243b5f" },
  installIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  installTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  installBody: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  installHi: { color: colors.amber, fontWeight: "700" },
});
