// Generates the browser-compatible version asset from the canonical shared
// source. The Expo service worker and Admin load the exported asset, and the
// Worker reads it to serve /version.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { APP_VERSION } from "../src/version.ts";

const targetArg = process.argv[2];
if (!targetArg) {
  throw new Error("Usage: generate-browser-version-js.mjs <target-path>");
}
const target = resolve(process.cwd(), targetArg);

const body = `/**
 * GENERATED FILE - DO NOT EDIT.
 * Source of truth: packages/config/src/version.ts.
 *
 * Exposes the current version for Admin, the service worker, and /version.
 */
globalThis.APP_VERSION = Object.freeze({
  build: ${JSON.stringify(APP_VERSION.build)},
  release: ${JSON.stringify(APP_VERSION.release)},
});
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, body);
console.log(`Generated ${target} from packages/config/src/version.ts (release ${APP_VERSION.release}, build ${APP_VERSION.build})`);
