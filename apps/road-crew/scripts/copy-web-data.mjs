// Copies the baked route data into public/data so the web export serves it at
// /data/* (matching how @road-crew/data fetches it: `${base}/data/sequences.json`).
//
// The pipeline owns the canonical baked data in packages/data/routes/. The
// exported app receives a copy at /data so the public URL stays unchanged.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appDir, "..", "..");
const SRC = join(repoRoot, "packages", "data", "routes");
const DEST = join(appDir, "public", "data");

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });

console.log(`Copied baked route data: ${SRC} -> ${DEST}`);
