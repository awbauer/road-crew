import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { colors } from "@road-crew/ui";
import type { Route } from "@road-crew/contracts";
import { ModalShell } from "@/ui/ModalShell";
import { ModalHeader } from "@/ui/ModalHeader";
import { pressFeedback } from "@/ui/pressFeedback";

/**
 * Route picker — lists every route so the driver can switch the active route
 * (header route button opens it). Mirrors the legacy route-picker dialog.
 */
export function RoutePicker({
  visible,
  routes,
  activeId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  routes: Route[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell visible={visible} onClose={onClose}>
      <ModalHeader kicker="ROUTE" title="Choose a route" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {routes.map((r) => {
          const active = r.id === activeId;
          return (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && pressFeedback.activeSubtle]}
              onPress={() => {
                onSelect(r.id);
                onClose();
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{r.name || r.id}</Text>
                <Text style={styles.meta}>
                  Day {r.day} · {r.sequence_count ?? r.sequences.length} seqs · {r.official_miles} mi
                </Text>
              </View>
              {active ? <FontAwesome6 name="check" size={16} color={colors.brandRed} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: "transparent" },
  rowActive: { borderColor: colors.brandRed },
  name: { color: colors.text, fontSize: 17, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 2 },
});
