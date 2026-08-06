require("tsx/cjs");

const { APP_VERSION } = require("../../packages/config/src/version.ts");

module.exports = ({ config }) => {
  // We build via `expo prebuild` + Xcode (not `eas build`), so the EAS Update
  // channel header is not injected automatically. Bake it into the binary from
  // EXPO_UPDATE_CHANNEL (set per Xcode Cloud workflow / exported before a local
  // build) so published updates can route to this install. Unset = no channel,
  // which is correct for local dev / Expo Go.
  const channel = process.env.EXPO_UPDATE_CHANNEL?.trim();

  return {
    ...config,
    version: APP_VERSION.release,
    // The committed native `ios/` project makes this a "bare" project, where EAS
    // Update does not support runtimeVersion policies (e.g. `appVersion`). Set an
    // explicit string instead — using the release version reproduces exactly what
    // the `appVersion` policy resolved to, and keeps it in sync automatically.
    runtimeVersion: APP_VERSION.release,
    updates: {
      ...config.updates,
      ...(channel
        ? {
            requestHeaders: {
              ...config.updates?.requestHeaders,
              "expo-channel-name": channel,
            },
          }
        : {}),
    },
    ios: {
      ...config.ios,
      buildNumber: APP_VERSION.build,
    },
    android: {
      ...config.android,
      versionCode: Number(APP_VERSION.build),
    },
  };
};
