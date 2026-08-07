import { FontAwesome6 } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "@road-crew/ui";
import { formatRelative, type CenterNotification } from "@road-crew/core";
import { ModalShell } from "@/ui/ModalShell";
import { ModalHeader } from "@/ui/ModalHeader";
import { pressFeedback } from "@/ui/pressFeedback";
import { useNow } from "@/ui/useNow";
import { useNotifications } from "./NotificationsProvider";
import { iconFor, actionLabelFor } from "./display";

// Pinned active notices appear first, then active, then labeled expired items.
// Each row includes a type icon, optional action, and relative timestamp.

function NotificationRow({ n, nowMs, onAction }: { n: CenterNotification; nowMs: number; onAction: (n: CenterNotification) => void }) {
  const actionLabel = actionLabelFor(n);
  return (
    <View style={[styles.row, n.read !== true && !n.expired && styles.rowUnread]}>
      <View style={styles.rowIcon}>
        <FontAwesome6 name={iconFor(n)} size={14} color={colors.text} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTags}>
          {n.pinnedActive ? (
            <View style={[styles.tag, styles.tagPinned]}>
              <FontAwesome6 name="thumbtack" size={9} color="#fff" />
              <Text style={styles.tagText}>Pinned</Text>
            </View>
          ) : null}
          {n.expired ? (
            <View style={[styles.tag, styles.tagExpired]}>
              <Text style={styles.tagText}>Expired</Text>
            </View>
          ) : null}
          {n.createdMs ? <Text style={styles.rowTime}>{formatRelative(n.createdMs, nowMs)}</Text> : null}
        </View>
        {n.title ? <Text style={styles.rowTitle}>{n.title}</Text> : null}
        {n.body ? <Text style={styles.rowText}>{n.body}</Text> : null}
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
    </View>
  );
}

export function NotificationCenter() {
  const { items, sheetVisible, closeSheet, runAction } = useNotifications();
  const nowMs = useNow(sheetVisible, 1_000);

  return (
    <ModalShell visible={sheetVisible} onClose={closeSheet}>
      <ModalHeader kicker="NOTIFICATIONS" title={items.length ? `${items.length} notice${items.length > 1 ? "s" : ""}` : "All caught up"} onClose={closeSheet} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {items.length ? (
          items.map((n) => <NotificationRow key={n.id} n={n} nowMs={nowMs} onAction={runAction} />)
        ) : (
          <Text style={styles.empty}>No notifications yet.</Text>
        )}
      </ScrollView>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30, gap: 12 },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: "center", paddingVertical: 24 },

  row: { flexDirection: "row", gap: 10, backgroundColor: colors.bgControl, borderRadius: 10, padding: 12 },
  rowUnread: { borderWidth: 1, borderColor: colors.brandRedDark },
  rowIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bgElevated, alignItems: "center", justifyContent: "center", marginTop: 2 },
  rowBody: { flex: 1, gap: 3 },
  rowTags: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tagPinned: { backgroundColor: colors.brandRedDark },
  tagExpired: { backgroundColor: colors.bgElevated },
  tagText: { color: "#fff", fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  rowTime: { color: colors.textSubtle, fontSize: 11 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  actionBtn: { alignSelf: "flex-start", marginTop: 6, backgroundColor: colors.brandRed, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
