import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { colors } from "@road-crew/ui";

/**
 * Shared centered modal chrome for the location/status popover, route
 * selection, and notifications.
 */
export function ModalShell({
  visible,
  onClose,
  children,
  maxWidth = 480,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.centerRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close modal"
        />
        <View style={[styles.card, { maxWidth }]}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centerRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.5)" },
  card: { width: "100%", backgroundColor: colors.bgPanel, borderRadius: 14, paddingTop: 16, maxHeight: "80%" },
});
