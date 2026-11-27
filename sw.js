// Service worker: makes the app open without network after the first visit.
//   - The app's own files: answered from the phone's cache at once, and refreshed in the background
//     ("stale-while-revalidate"), so a new version shows up on the next start.
//   - Map tiles you have looked at: kept (up to ~2,500 tiles ≈ 50 MB), so the map works offline where you've been.
//   - The backend (Google Apps Script): never cached here. The app keeps its own copy of the last data
//     in localStorage, and changes made offline wait in its outbox.
const SHELL = "shell-v5";
const TILES = "tiles-v1";
const MAX_TILES = 2500;

// Files needed to start the app. (Anything else of our own gets cached the first time it's used.)
const FILES = [
  "./", "index.html", "config.js", "css/app.css", "manifest.webmanifest",
  "js/app.js", "js/addplace.js", "js/data.js", "js/geo.js", "js/location.js", "js/logic.js", "js/map.js",
  "js/modes.js", "js/nav.js", "js/router.js", "js/routes.js", "js/sync.js", "js/ui.js", "js/views.js",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/ea-logo.svg",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => { // remove caches of older versions of this file
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => ![SHELL, TILES].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.endsWith("/exec")) return; // backend calls (also the local mock): network only
  if (url.origin === location.origin) return e.respondWith(staleWhileRevalidate(req));
  if (req.destination === "image" && /tile/.test(url.hostname)) return e.respondWith(tile(req));
  // everything else (the backend, the route server, Google Maps links) goes straight to the network
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  // ignoreSearch: "index.html?x" and "./" are the same page
  const cached = await cache.match(req, { ignoreSearch: req.mode === "navigate" }) ||
    (req.mode === "navigate" ? await cache.match("./") : undefined);
  // "no-cache" asks the server whether the file changed (cheap), instead of trusting the browser's own cache
  // (A page request can't be copied with new options, so it is fetched again by its address.)
  const fresh = fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" })
    .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => cached || Response.error());
  return cached || fresh;
}

async function tile(req) {
  const cache = await caches.open(TILES);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== "opaque") {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  } catch {
    return Response.error(); // offline and never seen: Leaflet shows an empty square
  }
}

// Forget the oldest tiles once there are too many (the cache lists them oldest first).
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
