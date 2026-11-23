// Service worker for the spike. Generated into dist/sw.js by vite.config.ts (PRECACHE is injected).
const CACHE = "tn2d-spike-__VERSION__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
// ignoreVary: module scripts send an Origin header and static servers may answer Vary: Origin.
// Cache-first for everything same-origin; audio and any other asset is added the first time it is fetched.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // navigations may carry a query string (?seed=..), the shell is cached without one
    caches.match(req, { ignoreSearch: req.mode === "navigate", ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
