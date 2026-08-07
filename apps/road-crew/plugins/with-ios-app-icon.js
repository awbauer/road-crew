const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

const APP_ICON_SET = "AppIcon.appiconset";

module.exports = function withIosAppIcon(config) {
  return withDangerousMod(config, ["ios", (config) => {
    const source = path.join(config.modRequest.projectRoot, "assets", APP_ICON_SET);
    const destination = path.join(
      config.modRequest.platformProjectRoot,
      "RoadCrew",
      "Images.xcassets",
      APP_ICON_SET,
    );

    if (!fs.existsSync(source)) {
      throw new Error(`Missing iOS app icon set: ${source}`);
    }

    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(source, destination, { recursive: true });
    return config;
  }]);
};
