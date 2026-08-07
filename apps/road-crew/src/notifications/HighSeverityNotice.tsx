import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { colors } from "@road-crew/ui";
import { ModalShell } from "@/ui/ModalShell";
import { ModalHeader } from "@/ui/ModalHeader";
import { pressFeedback } from "@/ui/pressFeedback";
import { useNotifications } from "./NotificationsProvider";
import { actionLabelFor } from "./display";

/** Blocking notice for high-severity Command directives, shown one at a time. */
export function HighSeverityNotice() {
  const { highSeverityNotice, runAction, dismissHighSeverityNotice } = useNotifications();
  if (!highSeverityNotice) return null;

  const n = highSeverityNotice;
  const actionLabel = actionLabelFor(n);

  return (
    <ModalShell visible={Boolean(n)} onClose={dismissHighSeverityNotice}>
      <ModalHeader kicker="COMMAND" title={n.title || "Notice"} onClose={dismissHighSeverityNotice} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
        {actionLabel ? (
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && pressFeedback.active]}
            onPress={() => runAction(n)}
            accessibilityRole="button"
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.dismissBtn, pressed && pressFeedback.active]}
          onPress={dismissHighSeverityNotice}
          accessibilityRole="button"
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      </ScrollView>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  actionBtn: { marginTop: 16, backgroundColor: colors.brandRed, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  dismissBtn: { marginTop: 10, backgroundColor: colors.bgControl, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  dismissText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
