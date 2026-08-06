// Minimal static server for the exported web app (apps/road-crew/dist) with
// SPA fallback — mirrors how the Cloudflare Worker serves the assets. Used for
// local preview/screenshots. Usage: node scripts/serve-dist.mjs [port]
import http from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(appDir, "dist");
const port = Number(process.argv[2] || process.env.PORT || 8790);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    let file = join(root, p);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.setHeader("content-type", TYPES[extname(file)] || "application/octet-stream");
    createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => {
    if (!existsSync(join(root, "index.html"))) {
      console.error(`No export found at ${root}. Run: npm run export:web`);
    }
    console.log(`Serving ${root} at http://localhost:${port}`);
  });
