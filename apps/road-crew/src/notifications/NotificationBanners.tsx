import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome6 } from "@expo/vector-icons";
import { colors } from "@road-crew/ui";
import type { SanitizedNotification } from "@road-crew/core";
import { pressFeedback } from "@/ui/pressFeedback";
import { shouldUseNativeAnimationDriver } from "@/ui/animationDriver";
import { useNotifications } from "./NotificationsProvider";
import { iconFor, actionLabelFor } from "./display";

const ICON_BG: Record<string, string> = {
  "app-update": colors.brandRedDark,
  "go-to-sequence": colors.green,
};

function Banner({ n, index, onAction, onDismiss }: {
  n: SanitizedNotification;
  index: number;
  onAction: (n: SanitizedNotification) => void;
  onDismiss: (id: string) => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      useNativeDriver: shouldUseNativeAnimationDriver(Platform.OS),
      friction: 9,
      tension: 60,
    }).start();
  }, [enter]);

  const actionLabel = actionLabelFor(n);
  const iconBg = ICON_BG[n.type] ?? colors.brandRed;

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
          opacity: enter,
        },
        index > 0 && styles.bannerStacked,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: iconBg }]}>
        <FontAwesome6 name={iconFor(n)} size={14} color="#fff" />
      </View>
      <View style={styles.body}>
        {n.title ? <Text style={styles.title} numberOfLines={2}>{n.title}</Text> : null}
        {n.body ? <Text style={styles.text} numberOfLines={3}>{n.body}</Text> : null}
        {actionLabel ? (
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && pressFeedback.active]}
            onPress={() => onAction(n)}
            accessibilityRole="button"
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={() => onDismiss(n.id)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
        style={({ pressed }) => [styles.closeBtn, pressed && pressFeedback.activeSubtle]}
      >
        <FontAwesome6 name="xmark" size={14} color={colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

/** Transient stack of banners for new info-severity notifications, mirroring
 * legacy's renderBanner (capped at 3, stays until dismissed or actioned).
 * Mount once near the app root. */
export function NotificationBanners() {
  const { bannerQueue, runAction, dismissBanner } = useNotifications();
  const insets = useSafeAreaInsets();

  if (!bannerQueue.length) return null;

  return (
    <View pointerEvents="box-none" style={[styles.root, { top: (Platform.OS === "web" ? 12 : insets.top) + 8 }]}>
      {bannerQueue.map((n, i) => (
        <Banner key={n.id} n={n} index={i} onAction={runAction} onDismiss={dismissBanner} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 12, right: 12, gap: 8, zIndex: 50 },
  banner: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  bannerStacked: { opacity: 0.94 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 1 },
  body: { flex: 1, gap: 3 },
  title: { color: colors.text, fontSize: 14, fontWeight: "700" },
  text: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  actionBtn: { alignSelf: "flex-start", marginTop: 6, backgroundColor: colors.brandRed, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  closeBtn: { padding: 2 },
});
