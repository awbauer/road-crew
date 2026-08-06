/*
 * Service worker for the universal web app (offline-first field use).
 * Runtime caching keyed off the shared app build number (from /js/version.js,
 * which the export generates from @road-crew/config) so a new deploy invalidates old
 * caches.
 *
 * - Navigations (SPA): network-first, fall back to the cached shell so deep
 *   routes work offline.
 * - Same-origin assets + /data/*: stale-while-revalidate.
 * - Mapbox styles, glyphs, sprites, and tiles: bounded stale-while-revalidate.
 * - /api/*, /version, and unrelated cross-origin requests: network-only.
 */
importScripts("/js/version.js");

const VERSION = (self.APP_VERSION && self.APP_VERSION.build) || "dev";
const CACHE = `rc-universal-${VERSION}`;
const MAPBOX_CACHE = "rc-mapbox-runtime-v1";
const MAPBOX_CACHE_LIMIT = 750;
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon-180.png",
  "/data/sequences.json",
  "/data/paths/day1_route1.json",
  "/data/paths/day1_route2.json",
  "/data/paths/day2_route1.json",
  "/data/paths/day2_route2.json",
  "/data/paths/day2_route3.json",
];
let mapboxEntryCount = null;
let mapboxWriteQueue = Promise.resolve();

function localAssetsFromHtml(html) {
  const urls = new Set();
  const matches = html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi);
  for (const match of matches) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin) urls.add(`${url.pathname}${url.search}`);
  }
  return [...urls];
}

async function fetchAndCache(cache, url) {
  const response = await fetch(url, { cache: "reload" });
  if (!response.ok) throw new Error(`Unable to precache ${url}: ${response.status}`);
  await cache.put(url, response);
}

async function precacheApp() {
  const cache = await caches.open(CACHE);
  const shell = await fetch("/index.html", { cache: "reload" });
  if (!shell.ok) throw new Error(`Unable to precache app shell: ${shell.status}`);
  const html = await shell.clone().text();
  await Promise.all([
    cache.put("/index.html", shell.clone()),
    cache.put("/", shell.clone()),
  ]);
  await Promise.all(
    [...new Set([...PRECACHE_URLS, ...localAssetsFromHtml(html)])]
      .map((url) => fetchAndCache(cache, url)),
  );
}

async function trimMapboxCache() {
  const cache = await caches.open(MAPBOX_CACHE);
  const keys = await cache.keys();
  const overflow = keys.length - MAPBOX_CACHE_LIMIT;
  if (overflow > 0) {
    await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
  }
  mapboxEntryCount = Math.min(keys.length, MAPBOX_CACHE_LIMIT);
}

function cacheMapboxResponse(cache, request, response) {
  const write = mapboxWriteQueue.then(async () => {
    if (mapboxEntryCount == null) mapboxEntryCount = (await cache.keys()).length;
    const alreadyCached = await cache.match(request);
    await cache.put(request, response);
    if (!alreadyCached) mapboxEntryCount += 1;
    if (mapboxEntryCount > MAPBOX_CACHE_LIMIT) await trimMapboxCache();
  });
  mapboxWriteQueue = write.catch(() => undefined);
  return write;
}

function isMapboxAsset(url) {
  return url.hostname === "api.mapbox.com"
    || url.hostname === "tiles.mapbox.com"
    || url.hostname.endsWith(".tiles.mapbox.com");
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheApp().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("rc-universal-") && k !== CACHE).map((k) => caches.delete(k)),
      );
      await trimMapboxCache();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (!isMapboxAsset(url)) return;
    const work = (async () => {
      const cache = await caches.open(MAPBOX_CACHE);
      const cached = await cache.match(req);
      const update = fetch(req).then(async (response) => {
        if (response.ok || response.type === "opaque") {
          await cacheMapboxResponse(cache, req, response.clone());
        }
        return response;
      });
      return { cached, update };
    })();
    event.respondWith(
      work.then(({ cached, update }) => cached || update.catch(() => Response.error())),
    );
    event.waitUntil(
      work.then(({ update }) => update.then(() => undefined, () => undefined)),
    );
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname === "/version") return; // dynamic API → network

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // SPA navigations: network-first, fall back to the cached shell offline.
      if (req.mode === "navigate") {
        try {
          const res = await fetch(req);
          cache.put("/index.html", res.clone());
          return res;
        } catch (_) {
          return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
        }
      }

      // Assets + baked data: stale-while-revalidate.
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
