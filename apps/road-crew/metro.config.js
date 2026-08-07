// Metro config for the monorepo: watch the workspace root so changes in
// packages/* are picked up, and resolve modules from both the app's and the
// root's node_modules (where the @road-crew/* workspace packages are symlinked).
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getSentryExpoConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// expo-sqlite's web backend (wa-sqlite) imports a .wasm module; register the
// extension so Metro resolves it for the web bundle.
if (!config.resolver.assetExts.includes("wasm")) {
  config.resolver.assetExts.push("wasm");
}

module.exports = config;
