// Service worker template. pwa/vite-plugin.ts writes dist/sw.js with the version and the precache list substituted below.
// Cache-first for same-origin GETs; a new build has a new cache name, the old one is deleted on activate.
const CACHE = 'tn2d-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // ignoreVary: module scripts send Origin and a static server may answer Vary: Origin.
    caches.match(req, { ignoreSearch: req.mode === 'navigate', ignoreVary: true }).then(
      (hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }),
    ),
  );
});
