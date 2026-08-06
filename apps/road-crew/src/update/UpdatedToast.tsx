import { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome6 } from "@expo/vector-icons";
import { APP_VERSION } from "@road-crew/config";
import { colors } from "@road-crew/ui";
import { captureError } from "@/monitoring";
import { consumePendingUpdatedToast } from "./updatedToastState";

const TAB_BAR_HEIGHT = Platform.OS === "ios" ? 49 : 56;
const TAB_BAR_GAP = 12;

export function UpdatedToast() {
  const [releaseVersion, setReleaseVersion] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    consumePendingUpdatedToast()
      .then((pending) => {
        if (!pending) return;
        if (!cancelled) setReleaseVersion(APP_VERSION.release);
      })
      .catch((error) => captureError(error, { tags: { source: "updated_toast" } }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!releaseVersion) return undefined;
    const animation = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(2_400),
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setReleaseVersion(null);
    });
    return () => animation.stop();
  }, [opacity, releaseVersion]);

  if (!releaseVersion) return null;

  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + TAB_BAR_HEIGHT + TAB_BAR_GAP }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[styles.toast, { opacity }]}
      >
        <FontAwesome6 name="circle-check" size={15} color={colors.green} />
        <Text style={styles.text}>App updated to v{releaseVersion}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: "center",
    left: 16,
    position: "absolute",
    right: 16,
    zIndex: 1000,
  },
  toast: {
    alignItems: "center",
    backgroundColor: colors.bgPanel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
});
