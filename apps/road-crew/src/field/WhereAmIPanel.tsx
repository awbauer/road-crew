import type { ComponentProps } from "react";
import { FontAwesome6 } from "@expo/vector-icons";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { colors } from "@road-crew/ui";
import {
  appleMapsCoordinateUrl,
  buildWhereAmIText,
  formatRelative,
  type WhereAmIView,
} from "@road-crew/core";
import { captureError } from "@/monitoring";
import { pressFeedback } from "@/ui/pressFeedback";

type IconName = ComponentProps<typeof FontAwesome6>["name"];

function DetailRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <FontAwesome6 name={icon} size={14} color={colors.textSubtle} style={styles.detailIcon} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function qualityWarning(view: WhereAmIView): string | null {
  if (view.quality.isPoorAccuracy) {
    return `Weak GPS (±${Math.round(view.quality.accuracyMeters ?? 0)} m) — these details may be inaccurate.`;
  }
  if (view.quality.needsRefresh) return "This fix is over two minutes old. Getting a fresher one…";
  if (view.quality.isStale) return "This fix is a little old.";
  if (view.quality.isLowAccuracy) return `Low GPS accuracy (±${Math.round(view.quality.accuracyMeters ?? 0)} m).`;
  return null;
}

/**
 * The driver-facing half of the location modal: where the van is, in the terms
 * a driver reads out over the radio. Everything here comes from the current fix
 * plus the bundled route data, so it stays populated offline; only the postal
 * address arrives late.
 */
export function WhereAmIPanel({ view, gpsError }: { view: WhereAmIView | null; gpsError: string | null }) {
  if (!view) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Location unavailable</Text>
        <Text style={styles.emptyBody}>
          {gpsError ?? "Waiting for a GPS fix. Check that location access is allowed for Road Crew."}
        </Text>
      </View>
    );
  }

  const summary = () => buildWhereAmIText(view, { relativeTime: formatRelative(view.timestampMs) });

  // The OS share sheet already offers Copy as one of its actions, so there is
  // no separate Copy Info button — one action instead of two doing the same
  // job, and no native clipboard module to keep linked into the binary.
  const handleShare = async () => {
    try {
      // Sharing works with or without the address — the coordinate link is
      // always resolvable by whoever receives it.
      await Share.share({
        message: `${summary()}\n${appleMapsCoordinateUrl(view.coordinate)}`,
        title: "Where am I?",
      });
    } catch (error) {
      captureError(error, { tags: { source: "where_am_i_share" } });
    }
  };

  const warning = qualityWarning(view);

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {warning ? (
          <View style={styles.warning}>
            <FontAwesome6 name="triangle-exclamation" size={12} color={colors.amber} />
            <Text style={styles.warningText}>{warning}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.cardBody}>
            <View style={[styles.cardIcon, styles.cardIconRed]}>
              <FontAwesome6 name="location-dot" size={18} color={colors.text} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTown}>{view.town ? view.town.toUpperCase() : "UNKNOWN TOWN"}</Text>
              {/* No town/state/zip here — that's what the geocoded address
                  normally carries, and this line is deliberately just the
                  street, sized as the card's focal point. */}
              <Text style={styles.cardStreet}>{view.street ?? "Unknown street"}</Text>
            </View>
          </View>
        </View>

        {/* No crossing resolved means no route selected, a fix off the route,
            or nothing authored within the search radius. The card said
            "Intersection unavailable" for all three, which reads as a fault in
            a box that is otherwise the driver's answer — so it is dropped
            entirely rather than left standing empty. */}
        {view.intersectionLabel ? (
          <View style={styles.card}>
            <Text style={styles.cardKicker}>CLOSEST INTERSECTION</Text>
            <View style={styles.cardBody}>
              <View style={[styles.cardIcon, styles.cardIconGreen]}>
                <FontAwesome6 name="plus" size={18} color={colors.text} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle2}>{view.intersectionLabel}</Text>
                {view.intersectionDistanceLabel ? (
                  <Text style={styles.cardSub}>{view.intersectionDistanceLabel}</Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardKicker}>DETAILS</Text>
          <View style={styles.details}>
            <DetailRow icon="signs-post" label="Street" value={view.street ?? "Unknown street"} />
            <DetailRow icon="location-crosshairs" label="Coordinates" value={view.coordinateLabel} />
            <DetailRow icon="list-ol" label="Sequence" value={view.sequenceLabel ?? "—"} />
            <DetailRow icon="compass" label="Heading" value={view.headingLabel ?? "Unavailable"} />
            <DetailRow icon="clock" label="Last updated" value={formatRelative(view.timestampMs)} />
          </View>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.btnGreen, pressed && pressFeedback.active]}
          onPress={handleShare}
          accessibilityRole="button"
        >
          <FontAwesome6 name="arrow-up-from-bracket" size={15} color="#fff" />
          <Text style={styles.btnText}>Share Location</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 12 },

  warning: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bgControl, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  warningText: { color: colors.textMuted, fontSize: 12, flex: 1 },

  card: { backgroundColor: colors.bgElevated, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  cardKicker: { fontSize: 10, letterSpacing: 0.8, fontWeight: "700", color: colors.textSubtle },
  cardBody: { flexDirection: "row", alignItems: "center", gap: 14 },
  cardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  cardIconRed: { backgroundColor: colors.brandRedDark },
  cardIconGreen: { backgroundColor: colors.green },
  cardText: { flex: 1, gap: 2 },
  cardStreet: { color: colors.text, fontSize: 22, fontWeight: "800" },
  cardTown: { color: colors.textMuted, fontSize: 15, fontWeight: "700" },
  cardTitle2: { color: colors.text, fontSize: 20, fontWeight: "700" },
  cardSub: { color: colors.textMuted, fontSize: 14 },

  details: { gap: 2 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  detailIcon: { width: 18, textAlign: "center" },
  detailLabel: { color: colors.textMuted, fontSize: 14, flex: 1 },
  detailValue: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },

  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  btnGreen: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.green, borderRadius: 8, paddingVertical: 14 },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  empty: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
