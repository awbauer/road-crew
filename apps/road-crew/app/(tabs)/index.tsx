import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { FontAwesome6 } from "@expo/vector-icons";
import type { ClientMessage } from "@road-crew/contracts";
import { useSession } from "@/auth/SessionProvider";
import { getConversation, getUnreadCount } from "@/db/messageRepository";
import { setBadgeCount } from "@/push/registration";
import { formatTime } from "@/lib/time";
import { theme } from "@road-crew/ui";

/**
 * Conversation list. Drivers have a single thread (with Command), but this is
 * modeled as a list so it scales to multiple conversations later. Tapping opens
 * the chat screen; the unread count also drives the native app badge.
 */
export default function Conversations() {
  const { vanId } = useSession();
  const [latest, setLatest] = useState<ClientMessage | null>(null);
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!vanId) return;
      let active = true;
      (async () => {
        const messages = await getConversation(vanId);
        const count = await getUnreadCount(vanId);
        if (!active) return;
        setLatest(messages.at(-1) ?? null);
        setUnread(count);
        void setBadgeCount(count);
      })();
      return () => {
        active = false;
      };
    }, [vanId]),
  );

  if (!vanId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Pick a van in app status to start chatting.</Text>
      </View>
    );
  }

  const preview = latest
    ? `${latest.senderType === "van" ? "You: " : ""}${latest.body}`
    : "No messages yet — say hello to Command.";

  return (
    <View style={styles.container}>
      <Pressable style={styles.row} onPress={() => router.push(`/chat/${encodeURIComponent(vanId)}`)}>
        <View style={styles.avatar}>
          <FontAwesome6 name="tower-broadcast" color={theme.colors.text} size={20} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowTitle}>Command</Text>
            <Text style={styles.rowTime}>{formatTime(latest?.createdAtServer || latest?.createdAtClient)}</Text>
          </View>
          <Text style={styles.rowPreview} numberOfLines={1}>
            {preview}
          </Text>
        </View>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background, padding: theme.spacing(3) },
  emptyText: { color: theme.colors.textMuted, fontSize: 16, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing(2),
    gap: theme.spacing(1.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between" },
  rowTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  rowTime: { color: theme.colors.textMuted, fontSize: 13 },
  rowPreview: { color: theme.colors.textMuted, marginTop: 2 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
});
