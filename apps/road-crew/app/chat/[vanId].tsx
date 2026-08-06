import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { FontAwesome6 } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ClientMessage } from "@road-crew/contracts";
import { useConversation } from "@/sync/useConversation";
import { clearBadge } from "@/push/registration";
import { formatTime } from "@/lib/time";
import { theme } from "@road-crew/ui";

/**
 * Chat screen for a van ↔ Command conversation. Deep-linkable as
 * `roadcrew://chat/<vanId>` (and from a push tap). Renders optimistic sends,
 * per-message delivery status, and a retry affordance for failed sends.
 */
export default function ChatScreen() {
  const params = useLocalSearchParams<{ vanId: string }>();
  const vanId = typeof params.vanId === "string" ? params.vanId : null;
  const insets = useSafeAreaInsets();
  const { messages, available, loading, send, retryFailed, markConversationRead } =
    useConversation(vanId);
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<ClientMessage>>(null);

  // Mark read + clear the native badge whenever this conversation is focused.
  useFocusEffect(
    useCallback(() => {
      void markConversationRead();
      void clearBadge();
    }, [markConversationRead]),
  );

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const onSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await send(body);
  };

  const hasFailed = messages.some((m) => m.status === "failed");

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Command · Van ${vanId ?? ""}` }} />

      {!available ? (
        <View style={styles.banner}>
          <FontAwesome6 name="triangle-exclamation" color={theme.colors.warning} size={14} />
          <Text style={styles.bannerText}>Command messaging is unavailable right now.</Text>
        </View>
      ) : null}

      {hasFailed ? (
        <Pressable style={styles.retryBar} onPress={retryFailed}>
          <FontAwesome6 name="rotate-right" color={theme.colors.text} size={14} />
          <Text style={styles.retryText}>Some messages didn't send. Tap to retry.</Text>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.clientMessageId || item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <MessageBubble message={item} />}
          ListEmptyComponent={
            loading ? null : (
              <Text style={styles.emptyText}>No messages yet. Send Command an update.</Text>
            )
          }
        />

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, theme.spacing(1)) }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={available ? "Message Command…" : "Messaging unavailable"}
            placeholderTextColor={theme.colors.textMuted}
            editable={available && Boolean(vanId)}
            multiline
            onSubmitEditing={onSend}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || !available) && styles.sendButtonDisabled]}
            onPress={onSend}
            disabled={!draft.trim() || !available}
          >
            <FontAwesome6 name="paper-plane" color={theme.colors.text} size={18} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MessageBubble({ message }: { message: ClientMessage }) {
  const mine = message.senderType === "van";
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={styles.bubbleBody}>{message.body}</Text>
        <View style={styles.bubbleMeta}>
          <Text style={styles.bubbleTime}>
            {formatTime(message.createdAtServer || message.createdAtClient)}
          </Text>
          {mine ? <StatusIcon status={message.status} /> : null}
        </View>
      </View>
    </View>
  );
}

function StatusIcon({ status }: { status: ClientMessage["status"] }) {
  if (status === "sent") {
    return <FontAwesome6 name="check" color={theme.colors.textMuted} size={11} />;
  }
  if (status === "failed") {
    return <FontAwesome6 name="circle-exclamation" color={theme.colors.danger} size={11} />;
  }
  // queued / sending
  return <FontAwesome6 name="clock" color={theme.colors.textMuted} size={11} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
  },
  bannerText: { color: theme.colors.textMuted, fontSize: 13 },
  retryBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    backgroundColor: theme.colors.accentMuted,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
  },
  retryText: { color: theme.colors.text, fontSize: 13 },
  list: { padding: theme.spacing(1.5), gap: theme.spacing(1), flexGrow: 1 },
  emptyText: {
    color: theme.colors.textMuted,
    textAlign: "center",
    marginTop: theme.spacing(6),
  },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: theme.radius, padding: theme.spacing(1.25) },
  bubbleMine: { backgroundColor: theme.colors.bubbleVan, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: theme.colors.bubbleCommand, borderBottomLeftRadius: 4 },
  bubbleBody: { color: theme.colors.text, fontSize: 15, lineHeight: 20 },
  bubbleMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(0.5),
    alignSelf: "flex-end",
    marginTop: 2,
  },
  bubbleTime: { color: theme.colors.textMuted, fontSize: 11 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  input: {
    flex: 1,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing(1.5),
    paddingVertical: theme.spacing(1),
    maxHeight: 120,
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: { backgroundColor: theme.colors.surfaceAlt },
});
