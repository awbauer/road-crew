import type { ResolvedAddress } from "@road-crew/core";

/**
 * True when this platform can reverse geocode at all. False on web, where the
 * modal reads town and street from the baked route data instead and never shows
 * an address row.
 */
export declare const REVERSE_GEOCODE_SUPPORTED: boolean;

/** Reverse geocoding must never hold the modal open. */
export declare const REVERSE_GEOCODE_TIMEOUT_MS: number;

/**
 * Turns a coordinate into a formatted address, or null when it can't be
 * resolved (offline, aborted, timed out, unsupported platform). Never throws.
 */
export declare function reverseGeocode(
  lat: number,
  lng: number,
  options?: { signal?: AbortSignal },
): Promise<ResolvedAddress | null>;
