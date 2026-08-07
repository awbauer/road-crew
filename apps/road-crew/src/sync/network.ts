import NetInfo from "@react-native-community/netinfo";
import { addBreadcrumb } from "@/monitoring";

/** Best-effort online check, mirroring the PWA's `navigator.onLine` gate. */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    // `isInternetReachable` can be null before the first probe — treat null as
    // "assume reachable" so we still attempt a send rather than queuing forever.
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch (error) {
    addBreadcrumb("netinfo fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/** Subscribe to connectivity changes; returns an unsubscribe fn. */
export function onConnectivityChange(handler: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((state) => {
    handler(state.isConnected !== false && state.isInternetReachable !== false);
  });
}
