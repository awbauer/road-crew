import type { ComponentProps } from "react";
import { FontAwesome6 } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@road-crew/ui";
import { pressFeedback } from "./pressFeedback";

/** Kicker + headline + close button, matching the version-notice dialog's
 * header. Shared across the field tabs' modal popovers for a consistent look.
 *
 * An optional leading `icon` badge sits left of the text; give it `onIconPress`
 * to make it a control (the Where am I? modal uses it to reveal diagnostics).
 * `meta` renders a small right-aligned line under the close button. */
export function ModalHeader({
  kicker,
  title,
  titleColor,
  onClose,
  icon,
  iconColor,
  onIconPress,
  iconAccessibilityLabel,
  meta,
}: {
  kicker?: string;
  title: string;
  titleColor?: string;
  onClose: () => void;
  icon?: ComponentProps<typeof FontAwesome6>["name"];
  iconColor?: string;
  onIconPress?: () => void;
  iconAccessibilityLabel?: string;
  meta?: string | null;
}) {
  const badge = icon ? (
    <View style={[styles.badge, iconColor ? { borderColor: iconColor } : null]}>
      <FontAwesome6 name={icon} size={18} color={iconColor ?? colors.text} />
    </View>
  ) : null;
  return (
    <View style={styles.head}>
      {badge && onIconPress ? (
        <Pressable
          onPress={onIconPress}
          accessibilityRole="button"
          accessibilityLabel={iconAccessibilityLabel ?? "Toggle details"}
          hitSlop={8}
          style={({ pressed }) => (pressed ? pressFeedback.activeSubtle : null)}
        >
          {badge}
        </Pressable>
      ) : badge}
      <View style={styles.headText}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={[styles.title, titleColor ? { color: titleColor } : null]}>{title}</Text>
      </View>
      <View style={styles.headRight}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <FontAwesome6 name="xmark" size={18} color={colors.textMuted} />
        </Pressable>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingHorizontal: 20 },
  headText: { flex: 1 },
  headRight: { alignItems: "flex-end", gap: 8 },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: { fontSize: 11, color: colors.brandRed, letterSpacing: 0.6, fontWeight: "700", textTransform: "uppercase" },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginTop: 4 },
  meta: { fontSize: 10, color: colors.textMuted, letterSpacing: 0.5, fontWeight: "600", textTransform: "uppercase" },
});
