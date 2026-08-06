/**
 * @param {{ vanId?: string | null, vanInstall?: boolean, vanInstallConfigured?: boolean, vanInstallSkipped?: boolean, buildVanInstall?: boolean }} [options]
 */
export function shouldShowVanInstall({
  vanId = null,
  vanInstall = false,
  vanInstallConfigured = false,
  vanInstallSkipped = false,
  buildVanInstall = false,
} = {}) {
  if (!buildVanInstall) return false;
  const buildDefault = buildVanInstall && !vanInstallConfigured;
  return Boolean(buildDefault || vanInstall) && !vanInstallSkipped && !vanId;
}

export function shouldInitializeVanInstall({ buildVanInstall = false, vanInstallConfigured = false } = {}) {
  return Boolean(buildVanInstall && !vanInstallConfigured);
}
