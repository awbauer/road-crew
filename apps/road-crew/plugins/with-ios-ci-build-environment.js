const { withXcodeProject } = require("expo/config-plugins");

const SENTRY_PHASE_NAME = "Upload Debug Symbols to Sentry";
const VERIFY_BUNDLE_PHASE_NAME = "Verify Embedded JavaScript Bundle";

const SENTRY_PHASE_SCRIPT = [
  'if [ -f "$PROJECT_DIR/.xcode.env" ]; then',
  '  . "$PROJECT_DIR/.xcode.env"',
  "fi",
  'if [ -f "$PROJECT_DIR/.xcode.env.local" ]; then',
  '  . "$PROJECT_DIR/.xcode.env.local"',
  "fi",
  'export SENTRY_ALLOW_FAILURE="${SENTRY_ALLOW_FAILURE:-true}"',
  '/bin/sh `"${NODE_BINARY:-node}" --print "require(\'path\').dirname(require.resolve(\'@sentry/react-native/package.json\')) + \'/scripts/sentry-xcode-debug-files.sh\'"`',
  "",
].join("\n");

const VERIFY_BUNDLE_PHASE_SCRIPT = [
  'case "$CONFIGURATION" in',
  "  *Debug*) exit 0 ;;",
  "esac",
  'BUNDLE_PATH="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/main.jsbundle"',
  'if [ ! -s "$BUNDLE_PATH" ]; then',
  '  echo "error: Release app is missing its embedded JavaScript bundle at $BUNDLE_PATH"',
  "  exit 1",
  "fi",
  "",
].join("\n");

function upsertShellScriptPhase(project, targetId, name, script) {
  const targetPhases = project.pbxNativeTargetSection()[targetId]?.buildPhases || [];
  const existingPhase = targetPhases.find((phase) => phase.comment === name);

  if (existingPhase) {
    const phase = project.hash.project.objects.PBXShellScriptBuildPhase[existingPhase.value];
    phase.shellPath = "/bin/sh";
    phase.shellScript = JSON.stringify(script);
    return;
  }

  project.addBuildPhase([], "PBXShellScriptBuildPhase", name, targetId, {
    shellPath: "/bin/sh",
    shellScript: script,
  });
}

module.exports = function withIosCiBuildEnvironment(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const targetName = config.modRequest.projectName || "";
    const targetId = project.findTargetKey(targetName);

    if (!targetId) {
      throw new Error(`Could not find the ${targetName || "app"} Xcode target`);
    }

    upsertShellScriptPhase(project, targetId, SENTRY_PHASE_NAME, SENTRY_PHASE_SCRIPT);
    upsertShellScriptPhase(
      project,
      targetId,
      VERIFY_BUNDLE_PHASE_NAME,
      VERIFY_BUNDLE_PHASE_SCRIPT,
    );

    return config;
  });
};
