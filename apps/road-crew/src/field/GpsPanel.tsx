import { StyleSheet, Text, View } from "react-native";
import { colors } from "@road-crew/ui";
import type { ReactNode } from "react";
import type { GpsStatus } from "./gpsStatus.ts";

/**
 * The GPS panel (vertical "GPS" label + heading/speed values + status box), shared by the
 * Sequences and Map screens. Off-route shows the amber "OFF ROUTE" + distance;
 * on-route shows a green street-sign with the next sequence's street + town.
 */
export function GpsPanel({
  status,
  beforeStatus,
  afterStatus,
  fillHeight = false,
}: {
  status: GpsStatus;
  beforeStatus?: ReactNode;
  afterStatus?: ReactNode;
  /**
   * Let the status box span the panel's full height instead of sitting inset.
   * Tablet headers give the panel a tall row, where the inset leaves the street
   * sign floating in the middle of it.
   */
  fillHeight?: boolean;
}) {
  const on = status.onRoute === true;
  const off = status.onRoute === false;
  const statusStyle = [styles.status, fillHeight && styles.statusFill];
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>GPS</Text>
      <View style={styles.meta} testID="gps-values">
        <Text style={styles.heading} testID="gps-heading">{status.headingLabel}</Text>
        <Text style={styles.speed} testID="gps-speed">{status.speedLabel}</Text>
      </View>
      {beforeStatus}
      {on ? (
        <View style={[statusStyle, styles.sign]} testID="gps-street-sign">
          {status.signTown ? (
            <Text style={styles.signTown} numberOfLines={1}>
              {status.signTown}
            </Text>
          ) : null}
          <Text style={styles.signStreet} numberOfLines={1}>
            {status.signStreet || "On route"}
          </Text>
        </View>
      ) : off ? (
        <View style={statusStyle}>
          <Text style={styles.statusLabelOff}>OFF ROUTE</Text>
          {status.distanceLabel ? <Text style={styles.statusDist}>{status.distanceLabel}</Text> : null}
        </View>
      ) : (
        <View style={statusStyle}>
          <Text style={styles.statusLabel}>{status.statusLabel}</Text>
        </View>
      )}
      {afterStatus}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 8, borderRightWidth: 1, borderRightColor: colors.border },
  label: { width: 24, textAlign: "center", color: colors.brandRed, fontSize: 10, fontWeight: "600", borderRightWidth: 1, borderRightColor: colors.border, paddingTop: 20 },
  meta: { minWidth: 54, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 4 },
  heading: { fontSize: 13, fontWeight: "700", color: colors.text },
  speed: { fontSize: 11, fontWeight: "600", color: colors.textSubtle },
  status: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1, borderRadius: 8, marginVertical: 6, marginRight: 6, backgroundColor: colors.routeOffBg, paddingHorizontal: 8 },
  // Tablet headers hand the panel a tall row; drop the vertical inset so the
  // street sign spans it rather than floating in the middle.
  statusFill: { marginVertical: 0 },
  statusLabel: { color: colors.textSubtle, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  statusLabelOff: { color: colors.amber, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  statusDist: { color: "#fff", fontSize: 26, fontWeight: "800" },
  // Green street sign (on route)
  sign: { backgroundColor: colors.routeOnBg, borderWidth: 1.5, borderColor: "#3f8f5f" },
  signTown: { color: colors.routeOnText, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  signStreet: { color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" },
});
