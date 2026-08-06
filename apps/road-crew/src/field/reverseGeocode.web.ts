import type { ResolvedAddress } from "@road-crew/core";

// The browser build does not reverse geocode. Mapbox geocoding is packaged with
// the native app — that is what a driver runs in a van, and it is where a billed
// request buys something. On web the modal reads its town and street from the
// baked route data and shows no address row at all, which is honest about what
// it knows rather than showing a permanent "Address unavailable".
//
// `REVERSE_GEOCODE_SUPPORTED` is what callers branch on: `useWhereAmI` never
// starts its lookup loop, so no request, cache write or loading state happens
// here.
export const REVERSE_GEOCODE_SUPPORTED = false;

export const REVERSE_GEOCODE_TIMEOUT_MS = 5_000;

export async function reverseGeocode(
  _lat: number,
  _lng: number,
  _options: { signal?: AbortSignal } = {},
): Promise<ResolvedAddress | null> {
  return null;
}
