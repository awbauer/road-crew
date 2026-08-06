export declare function syncBackgroundLocationReporting(input: {
  reportingVan: boolean;
  vanId: string | null;
  trackingEnabled?: boolean;
  requestPermissions?: boolean;
}): Promise<void>;

export declare function applyBackgroundLocationPolicy(
  pausesUpdatesAutomatically: boolean | undefined,
  requestPermissions?: boolean,
): Promise<void>;
