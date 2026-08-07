export const TABLET_ROUTE_MIN_DIMENSION = 768;

/**
 * Shared policy for exposing the combined tablet Route workspace.
 *
 * Native tablet identity wins over the current window dimensions so an iPad
 * keeps the Route workspace in split view and other compact window modes. Web
 * remains responsive to the available viewport.
 */
export function usesTabletRouteWorkspace(
  width: number,
  height: number,
  isNativeTablet = false,
): boolean {
  return isNativeTablet || Math.min(width, height) >= TABLET_ROUTE_MIN_DIMENSION;
}
