import { useCallback } from "react";
import { router, useLocalSearchParams } from "expo-router";

/**
 * One-shot sequence-to-map request shared by the phone Map screen and the
 * tablet Route workspace. The map adapter acknowledges it after opening the
 * popup, then the request is removed from the current route.
 */
export function useSequenceJumpRequest(): {
  sequenceNumber: number | null;
  consume: () => void;
} {
  const params = useLocalSearchParams<{ sequence?: string }>();
  const parsed = Number.parseInt(String(params.sequence ?? ""), 10);
  const sequenceNumber = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  const consume = useCallback(() => {
    router.setParams({ sequence: undefined });
  }, []);

  return { sequenceNumber, consume };
}
