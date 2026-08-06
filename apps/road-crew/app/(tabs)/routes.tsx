import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import type { RouteSummary } from "@road-crew/contracts";
import { fetchRoutes } from "@/api/routes";
import { useSession } from "@/auth/SessionProvider";
import { captureError } from "@/monitoring";
import { theme } from "@road-crew/ui";

/**
 * Route / van context. Shows the active van and lets the driver pick the route
 * they're covering. The selection is persisted in the session and is the seam
 * for route-scoped status updates and route-targeted notifications.
 */
export default function Routes() {
  const { vanId, routeId, selectRoute } = useSession();
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchRoutes()
      .then((list) => active && setRoutes(list))
      .catch((error) => {
        if (active) setError("Couldn't load routes. They'll appear once you're back online.");
        captureError(error, { tags: { source: "route_context_load" } });
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const toggleRoute = async (nextRouteId: string | null) => {
    try {
      await selectRoute(nextRouteId);
    } catch (error) {
      setError("Couldn't save your route selection. Try again.");
      captureError(error, {
        tags: { source: "route_context_select" },
        extra: { routeId: nextRouteId, vanId },
      });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.contextCard}>
        <Text style={styles.contextLabel}>Your van</Text>
        <Text style={styles.contextValue}>{vanId ?? "Not selected"}</Text>
      </View>

      <Text style={styles.sectionHeading}>Route you're covering</Text>
      {loading ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: theme.spacing(3) }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: theme.spacing(1.5), paddingVertical: theme.spacing(1) }}
          renderItem={({ item }) => {
            const selected = item.id === routeId;
            return (
              <Pressable
                style={[styles.routeRow, selected && styles.routeRowSelected]}
                onPress={() => {
                  void toggleRoute(selected ? null : item.id);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeName}>{item.name}</Text>
                  <Text style={styles.routeMeta}>
                    Day {item.day} · Route {item.route} · {item.official_miles} mi ·{" "}
                    {item.sequence_count} stops
                  </Text>
                </View>
                {selected ? (
                  <FontAwesome6 name="circle-check" color={theme.colors.accent} size={22} />
                ) : (
                  <FontAwesome6 name="circle" color={theme.colors.border} size={22} />
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: theme.spacing(2), backgroundColor: theme.colors.background },
  contextCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(2),
  },
  contextLabel: { color: theme.colors.textMuted, fontSize: 13, textTransform: "uppercase" },
  contextValue: { color: theme.colors.accent, fontSize: 28, fontWeight: "800", marginTop: 2 },
  sectionHeading: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(1),
  },
  error: { color: theme.colors.danger, marginTop: theme.spacing(2) },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1.5),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(2),
  },
  routeRowSelected: { borderColor: theme.colors.accent },
  routeName: { color: theme.colors.text, fontSize: 16, fontWeight: "600" },
  routeMeta: { color: theme.colors.textMuted, marginTop: 2, fontSize: 13 },
});
