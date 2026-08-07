import { APP_CONFIG } from "@road-crew/config";
import type { ResolvedAddress } from "@road-crew/core";

// Mapbox reverse geocoding, native only. The OS geocoders were tried first and
// dropped — they answer with a postal locality and a coarse street — and the
// bundled route data is only granular at sequence points, so neither could name
// the road a van is actually parked on between cues. Mapbox returns the most
// specific feature it has (address, else street, else place), using the same
// public token the map already authenticates with.
//
// This is the app running in a van, which is where the answer has to be right.
// The web build deliberately has no geocoder (see `reverseGeocode.web.ts`), so
// the billed request only ever comes from a real field device.
//
// Requests are made when the modal opens and are cached by distance (see
// `addressCache`), so a van sitting still costs one lookup, not one per fix.
const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/reverse";

export const REVERSE_GEOCODE_SUPPORTED = true;

/** Reverse geocoding must never hold the modal open. */
export const REVERSE_GEOCODE_TIMEOUT_MS = 5_000;

interface MapboxContextEntry {
  name?: string;
}

interface MapboxFeature {
  properties?: {
    full_address?: string;
    place_formatted?: string;
    name?: string;
    feature_type?: string;
    context?: {
      street?: MapboxContextEntry;
      place?: MapboxContextEntry;
      locality?: MapboxContextEntry;
      neighborhood?: MapboxContextEntry;
    };
  };
}

/**
 * Turns a coordinate into a formatted address, or null when it can't be
 * resolved (offline, aborted, timed out, no token). Never throws — the modal's
 * local fields must survive a failed lookup.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ResolvedAddress | null> {
  const token = APP_CONFIG.mapboxToken;
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    // No `types` filter: the default reverse lookup returns the most specific
    // feature available, which on a rural road is the street rather than a
    // house number.
    const url = `${ENDPOINT}?longitude=${lng}&latitude=${lat}&limit=1&access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { features?: MapboxFeature[] };
    const props = body.features?.[0]?.properties;
    if (!props) return null;
    const formatted = props.full_address
      ?? [props.name, props.place_formatted].map((p) => (p ?? "").trim()).filter(Boolean).join(", ");
    if (!formatted) return null;
    // For an "address" feature, `name` is the house number and street
    // ("123 Seekonk St") with no town/state/zip — more specific than
    // `context.street.name` ("Seekonk St") and exactly what the modal's
    // street line wants. For a "street" feature (no specific address to
    // resolve to) there is no house number either way, so both sources agree.
    // Any other feature type (place, locality, ...) leaves street unset rather
    // than reusing `name`, which there would be the town or region, not a road.
    const street = props.feature_type === "address"
      ? (props.name ?? props.context?.street?.name ?? null)
      : (props.context?.street?.name ?? (props.feature_type === "street" ? props.name ?? null : null));
    return {
      formatted,
      street: street ?? null,
      // `place` is the municipality; `locality` covers the villages that sit
      // inside one.
      locality: props.context?.place?.name ?? props.context?.locality?.name ?? null,
    };
  } catch {
    // Offline or aborted: the modal keeps every local field and falls back to
    // the bundled town and street.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
