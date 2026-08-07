// Shared sequence formatting helpers used by both the list and detail views.
// Ported verbatim from app/js/sequence.js; behavior is intentionally unchanged.

import type { Sequence } from "@road-crew/contracts";

const DIRECTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  L: "Left",
  R: "Right",
  S: "Straight",
});

const FLAG_LABELS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ["water_stop", "Water stop"],
  ["police", "Police"],
  ["road_crew", "Road crew"],
  ["mh_sign", "Mass Hwy sign"],
] as const);

function normalizedHouseNumber(rawNum: unknown): string {
  if (rawNum == null || rawNum === "") return "";

  const parsed = Number(rawNum);
  if (Number.isFinite(parsed) && parsed > 0) return String(Math.trunc(parsed));

  const text = String(rawNum).trim();
  return text && text !== "0" && text !== "0.0" ? text : "";
}

export function sequenceAddress(seq: Sequence | null | undefined): string {
  const parts = [
    normalizedHouseNumber(seq?.num_first),
    seq?.street,
    seq?.town,
    "MA",
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return parts.join(" ");
}

/**
 * The navigation destination for a sequence: always its GPS point, never its
 * address.
 *
 * A sequence is a position on a route, not a postal address. `num_first`,
 * `street` and `town` describe the cue — the road you turn onto, the block it
 * happens on — so handing them to a maps app asks that app to re-geocode a
 * description of somewhere near the point back into a point, and it can land on
 * the wrong end of a long street, the wrong "Main St", or a house number that
 * does not exist. The route data already carries the exact coordinate the cue
 * was authored against, so there is nothing to re-derive.
 *
 * Returns "" when a sequence has no usable coordinate, which callers turn into
 * a dead link rather than navigating somewhere plausible but wrong. The
 * previous address form could not express that: `sequenceAddress` appends "MA"
 * unconditionally, so a sequence with no street or town still produced a
 * non-empty address and navigated the driver to the middle of the state.
 *
 * Mirrors `cumberlandFarmNavigationHref`, which has always been coordinate-based.
 */
export function sequenceDestination(seq: Sequence | null | undefined): string {
  return hasCoordinates(seq) ? `${seq!.lat},${seq!.lng}` : "";
}

export function appleMapsHref(seq: Sequence | null | undefined): string {
  const destination = sequenceDestination(seq);
  return destination ? `https://maps.apple.com/?daddr=${destination}&dirflg=d` : "#";
}

export function googleMapsHref(seq: Sequence | null | undefined): string {
  const destination = sequenceDestination(seq);
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${destination}` : "#";
}

export function wazeHref(seq: Sequence | null | undefined): string {
  const destination = sequenceDestination(seq);
  // `ll` rather than the `q` search field the address form used: `q` asks Waze
  // to search for the text, `ll` is the literal point.
  return destination ? `https://waze.com/ul?ll=${destination}&navigate=yes` : "#";
}

export function navigationHref(seq: Sequence | null | undefined, providerId = "apple"): string {
  if (providerId === "google") return googleMapsHref(seq);
  if (providerId === "waze") return wazeHref(seq);
  return appleMapsHref(seq);
}

// App-scheme variants — these launch the native map app DIRECTLY (no web page /
// in-app browser first), for use on-device. Fall back to the https universal
// links (navigationHref) if the app isn't installed.
export function appleMapsScheme(seq: Sequence | null | undefined): string {
  const destination = sequenceDestination(seq);
  return destination ? `maps://?daddr=${destination}&dirflg=d` : "#";
}

export function googleMapsScheme(seq: Sequence | null | undefined): string {
  const destination = sequenceDestination(seq);
  return destination ? `comgooglemaps://?daddr=${destination}&directionsmode=driving` : "#";
}

export function wazeScheme(seq: Sequence | null | undefined): string {
  const destination = sequenceDestination(seq);
  return destination ? `waze://?ll=${destination}&navigate=yes` : "#";
}

export function navigationScheme(seq: Sequence | null | undefined, providerId = "apple"): string {
  if (providerId === "google") return googleMapsScheme(seq);
  if (providerId === "waze") return wazeScheme(seq);
  return appleMapsScheme(seq);
}

export function directionLabel(dir: string | null | undefined): string {
  return DIRECTION_LABELS[dir as string] || dir || "—";
}

export function sequenceFlags(seq: Sequence | null | undefined): string[] {
  return FLAG_LABELS
    .filter(([key]) => Boolean(seq?.[key]))
    .map(([, label]) => label);
}

export function hasCoordinates(seq: Sequence | null | undefined): boolean {
  return Number.isFinite(seq?.lat) && Number.isFinite(seq?.lng);
}
