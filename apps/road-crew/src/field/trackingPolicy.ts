export interface ResolvedTrackingState {
  locationTrackingAllowed: boolean;
  remoteTrackingEnabled: boolean;
}

/**
 * Resolves server policy before an individual device command. A global
 * tracking shutdown always wins, including over a queued enable command.
 * Removing the shutdown unlocks the control but never resumes sharing without
 * a separate local or Command choice.
 */
export function resolveHeartbeatTrackingState({
  currentAllowed,
  currentTrackingEnabled,
  serverAllowsTracking,
  commandedTrackingEnabled,
}: {
  currentAllowed: boolean;
  currentTrackingEnabled: boolean;
  serverAllowsTracking?: boolean;
  commandedTrackingEnabled?: boolean;
}): ResolvedTrackingState {
  const locationTrackingAllowed = typeof serverAllowsTracking === "boolean"
    ? serverAllowsTracking
    : currentAllowed;
  const requestedTrackingEnabled = typeof commandedTrackingEnabled === "boolean"
    ? commandedTrackingEnabled
    : currentTrackingEnabled;
  return {
    locationTrackingAllowed,
    remoteTrackingEnabled: locationTrackingAllowed && requestedTrackingEnabled,
  };
}

export function shouldShowTrackingControl(
  canConfigureVanInstall: boolean,
  locationTrackingAllowed: boolean,
): boolean {
  return canConfigureVanInstall && locationTrackingAllowed;
}
