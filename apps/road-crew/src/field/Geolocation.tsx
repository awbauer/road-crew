import { createContext, useContext, type ReactNode } from "react";
import { useGeolocation } from "./useGeolocation";
import type { Fix } from "./geolocation-types.ts";

interface GeolocationContextValue {
  fix: Fix | null;
  error: string | null;
  requestFix: () => Promise<Fix | null>;
}

const GeolocationContext = createContext<GeolocationContextValue>({
  fix: null,
  error: null,
  requestFix: async () => null,
});

/**
 * A single shared GPS watch for the whole field-guide shell (mirrors the
 * legacy app/js/gps.js singleton module). Mounting this once — instead of
 * calling `useGeolocation()` independently in Sequences, Map, and the Status
 * sheet — means switching tabs doesn't re-acquire GPS or flash "Acquiring
 * GPS…", and the Status sheet can show the live fix.
 */
export function GeolocationProvider({ children }: { children: ReactNode }) {
  const value = useGeolocation();
  return <GeolocationContext.Provider value={value}>{children}</GeolocationContext.Provider>;
}

export function useSharedGeolocation() {
  return useContext(GeolocationContext);
}
