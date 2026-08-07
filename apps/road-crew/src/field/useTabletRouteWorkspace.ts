import { Platform, useWindowDimensions } from "react-native";
import { isTabletDevice } from "@/field/deviceType";
import { usesTabletRouteWorkspace } from "@/field/layout";

/**
 * Keeps native tablets on the combined Route workspace even when the current
 * app window is narrower or shorter than the web/tablet breakpoint.
 */
export function useTabletRouteWorkspace(): boolean {
  const { width, height } = useWindowDimensions();
  // Same tablet detection the heartbeat reports to Command, so the workspace
  // and the admin Device column can never disagree about what this device is.
  const isNativeTablet = Platform.OS !== "web" && isTabletDevice();

  return usesTabletRouteWorkspace(width, height, isNativeTablet);
}
