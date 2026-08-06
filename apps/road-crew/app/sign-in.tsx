import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { Van } from "@road-crew/contracts";
import { fetchVans } from "@/api/vans";
import { useSession } from "@/auth/SessionProvider";
import { captureError } from "@/monitoring";
import { pressFeedback } from "@/ui/pressFeedback";
import { theme } from "@road-crew/ui";

/**
 * Van picker — the driver's "sign in". Selecting a van establishes the session
 * identity used for messaging and push registration.
 */
export default function SignIn() {
  const { signIn } = useSession();
  const [vans, setVans] = useState<Van[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchVans()
      .then((list) => {
        if (active) setVans(list);
      })
      .catch((error) => {
        if (active) setError("Couldn't load the van list. Check your connection and try again.");
        captureError(error, { tags: { source: "van_picker_load" } });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const choose = async (vanId: string) => {
    try {
      await signIn(vanId);
      router.replace("/(tabs)");
    } catch (error) {
      setError("Couldn't save your van selection. Try again.");
      captureError(error, { tags: { source: "van_picker_sign_in" }, extra: { vanId } });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Which van are you in?</Text>
      <Text style={styles.subheading}>
        Pick your van to start chatting with Command. You can change it later in app status.
      </Text>

      {loading ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: theme.spacing(4) }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={vans}
          keyExtractor={(item) => item.number}
          numColumns={2}
          columnWrapperStyle={{ gap: theme.spacing(1.5) }}
          contentContainerStyle={{ gap: theme.spacing(1.5), paddingVertical: theme.spacing(2) }}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.vanTile, pressed && pressFeedback.active]}
              onPress={() => choose(item.number)}
            >
              <Text style={styles.vanNumber}>{item.number}</Text>
              <Text style={styles.vanLabel}>{item.label}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: theme.spacing(2), backgroundColor: theme.colors.background },
  heading: { color: theme.colors.text, fontSize: 24, fontWeight: "700" },
  subheading: { color: theme.colors.textMuted, marginTop: theme.spacing(1), fontSize: 15 },
  error: { color: theme.colors.danger, marginTop: theme.spacing(3), fontSize: 15 },
  vanTile: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing(2.5),
    alignItems: "center",
  },
  vanNumber: { color: theme.colors.accent, fontSize: 32, fontWeight: "800" },
  vanLabel: { color: theme.colors.textMuted, marginTop: theme.spacing(0.5) },
});
