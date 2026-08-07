import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@road-crew/ui";
import type { Van } from "@road-crew/contracts";
import { fetchVans } from "@/api/vans";
import { useSession } from "@/auth/SessionProvider";
import { shouldInitializeVanInstall } from "@/auth/vanInstallMode.js";
import { CONFIG } from "@/config";
import { captureError } from "@/monitoring";
import { pressFeedback } from "@/ui/pressFeedback";

/**
 * Native-only van-install picker. The hosted web app never reaches this route.
 * Persisted state cannot expose this picker on web.
 * Picking a van sets the session van AND enables location reporting. Skipping
 * leaves the device with no van for now, but the app keeps the persisted install
 * attribute and will not ask again until Reset App clears the skip marker.
 */
export default function VanInstall() {
  const {
    ready,
    vanId,
    vanInstall,
    vanInstallConfigured,
    vanInstallSkipped,
    enableVanInstall,
    skipVanInstall,
    installVan,
  } = useSession();
  const [vans, setVans] = useState<Van[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const buildVanInstall = CONFIG.vanInstallEnabled;
  const buildDefault = shouldInitializeVanInstall({ buildVanInstall, vanInstallConfigured });
  const canUseVanInstall = buildVanInstall && (buildDefault || vanInstall) && !vanInstallSkipped;

  useEffect(() => {
    if (!ready || !buildDefault) return;
    void enableVanInstall();
  }, [ready, buildDefault, enableVanInstall]);

  useEffect(() => {
    if (!ready || !canUseVanInstall || vanId) return;
    let active = true;
    fetchVans()
      .then((list) => {
        if (active) setVans(list);
      })
      .catch((err) => {
        if (active) setError("Couldn't load the van list. Check your connection and try again.");
        captureError(err, { tags: { source: "van_install_load" } });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ready, canUseVanInstall, vanId]);

  if (!ready) return null;
  if (!canUseVanInstall || vanId) {
    return <Redirect href="/(field)/home" />;
  }

  const choose = async (vanId: string) => {
    try {
      await installVan(vanId);
      router.replace("/(field)/home");
    } catch (err) {
      setError("Couldn't save your van selection. Try again.");
      captureError(err, { tags: { source: "van_install_select" }, extra: { vanId } });
    }
  };

  const skip = async () => {
    try {
      await skipVanInstall();
      router.replace("/(field)/home");
    } catch (err) {
      setError("Couldn't save your choice. Try again.");
      captureError(err, { tags: { source: "van_install_skip" } });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <Text style={styles.heading}>Which van is this?</Text>
      <Text style={styles.subheading}>
        Pick your van so the crew can see you on the map. This device will share its
        location while a van is selected. You can change this later in Status.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.brandRed} style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={vans}
          keyExtractor={(item) => item.number}
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ gap: 10, paddingVertical: 16 }}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.vanTile, pressed && pressFeedback.active]}
              onPress={() => choose(item.number)}
              accessibilityRole="button"
              accessibilityLabel={`Select ${item.label}`}
            >
              <Text style={styles.vanLabel}>{item.label}</Text>
            </Pressable>
          )}
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.skip, pressed && pressFeedback.activeSubtle]}
        onPress={skip}
        accessibilityRole="button"
        accessibilityLabel="Skip van selection"
      >
        <Text style={styles.skipText}>Skip for now</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, padding: 16, backgroundColor: colors.bg },
  heading: { color: colors.text, fontSize: 24, fontWeight: "800" },
  subheading: { color: colors.textMuted, marginTop: 8, fontSize: 15, lineHeight: 20 },
  error: { color: colors.amber, marginTop: 24, fontSize: 15 },
  vanTile: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 20,
    alignItems: "center",
  },
  vanLabel: { color: colors.text, fontSize: 20, fontWeight: "800" },
  skip: { paddingVertical: 14, alignItems: "center" },
  skipText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
});
