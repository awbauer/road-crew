export async function syncBackgroundLocationReporting(_input: {
  reportingVan: boolean;
  vanId: string | null;
  trackingEnabled?: boolean;
  requestPermissions?: boolean;
}): Promise<void> {
  // Browsers use their existing foreground heartbeat and do not support Expo's
  // native background location task.
}

export async function applyBackgroundLocationPolicy(
  _pausesUpdatesAutomatically: boolean | undefined,
  _requestPermissions = true,
): Promise<void> {
  // Browser installs do not register an Expo background-location task.
}
