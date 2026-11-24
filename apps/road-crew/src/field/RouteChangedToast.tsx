import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome6 } from "@expo/vector-icons";
import { colors } from "@road-crew/ui";

const TAB_BAR_HEIGHT = Platform.OS === "ios" ? 49 : 56;
const listeners = new Set<() => void>();
let currentMessage: string | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export function showRouteChangedToast(routeName: string) {
  currentMessage = `App changed routes to ${routeName}`;
  if (dismissTimer) clearTimeout(dismissTimer);
  for (const listener of listeners) listener();
  dismissTimer = setTimeout(() => {
    currentMessage = null;
    for (const listener of listeners) listener();
    dismissTimer = null;
  }, 3_000);
}

export function RouteChangedToast() {
  const [message, setMessage] = useState(currentMessage);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const listener = () => setMessage(currentMessage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    // VoiceOver ignores `accessibilityLiveRegion` (Android only) and cannot
    // reach a pointer-events-none toast, so the change is announced outright.
    AccessibilityInfo.announceForAccessibility(message);
    const animation = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(2_600),
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [message, opacity]);

  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + TAB_BAR_HEIGHT + 12 }]}>
      <Animated.View accessibilityLiveRegion="polite" style={[styles.toast, { opacity }]}>
        <FontAwesome6 name="route" size={14} color={colors.brandRed} />
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 16, right: 16, alignItems: "center", zIndex: 1000 },
  toast: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.bgPanel, borderWidth: 1, borderColor: colors.border },
  text: { color: colors.text, fontSize: 13, fontWeight: "700" },
});
