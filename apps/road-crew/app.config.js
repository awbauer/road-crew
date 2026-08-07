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
    // Set as an explicit string rather than a policy (e.g. `appVersion`), so the
    // runtime version stays stable whether or not a native project is checked in
    // — a prebuilt `ios/` tree would make this a "bare" project, where EAS Update
    // does not support policies at all. Using the release version reproduces what
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
