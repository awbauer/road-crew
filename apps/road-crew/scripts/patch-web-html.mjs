// Post-processes the exported dist/index.html to add the PWA head that the
// legacy app/index.html shipped. Expo's `output: "single"` generates a fixed
// index.html template and does not use `app/+html.tsx`, so we inject the
// installable-manifest link, dark theme color, and iOS web-app + safe-area
// viewport here. Idempotent: safe to re-run against a fresh export.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(appDir, "dist", "index.html");

const HEAD_TAGS = [
  '<meta name="theme-color" content="#0b0b0d" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="Road Crew" />',
  '<meta name="format-detection" content="telephone=no" />',
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png" />',
  '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
  '<link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png" />',
  // Dark document/root background (so safe-area insets don't show white) +
  // full dynamic-viewport height (so the tab bar stays pinned to the bottom in
  // a standalone PWA instead of floating mid-screen).
  '<style>html,body,#root{background-color:#0b0b0d;height:100dvh;min-height:100dvh;}</style>',
].join("\n    ");

let html = readFileSync(htmlPath, "utf8");

// Use the installed-PWA viewport (safe-area cover, no user zoom) from the PWA.
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />',
);

// Inject the PWA head tags once, right before </head>.
if (!html.includes('rel="manifest"')) {
  html = html.replace("</head>", `  ${HEAD_TAGS}\n  </head>`);
}

if (!html.includes("calcite-mode-dark")) {
  html = html.replace(/<body([^>]*)>/, '<body$1 class="calcite-mode-dark">');
}

writeFileSync(htmlPath, html);
console.log(`Patched PWA head into ${htmlPath}`);
