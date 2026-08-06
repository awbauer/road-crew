import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const roadCrewDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(roadCrewDir, "dist");

function run(command, args) {
  const result = spawnSync(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "copy:web-data"]);
run("npm", ["run", "gen:web-version"]);
run("expo", ["export", "--platform", "web"]);
run("node", ["scripts/patch-web-html.mjs"]);

if (!existsSync(distDir)) throw new Error(`Road Crew export is missing: ${distDir}`);
console.log(`Road Crew web export ready: ${distDir}`);
