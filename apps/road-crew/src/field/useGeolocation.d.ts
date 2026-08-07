// Type surface for the platform-split geolocation hook
// (useGeolocation.web.ts / useGeolocation.native.ts).
import type { Fix } from "./geolocation-types.ts";

export declare function useGeolocation(): {
  fix: Fix | null;
  error: string | null;
  requestFix: () => Promise<Fix | null>;
};
