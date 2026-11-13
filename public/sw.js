// VibeRoom web: lets the site open without internet and shows downloaded songs' covers offline.
// - Pages: try the network first (so new versions arrive), fall back to the saved copy.
// - The site's own files (scripts, fonts, images): saved the first time they load.
// - Anything saved by "Download" (songs, covers): answered from that cache when offline.
const APP_CACHE = 'viberoom-app-v1';
const DOWNLOADS = 'viberoom-downloads';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/', { cacheName: APP_CACHE })),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { cacheName: APP_CACHE }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // Covers and songs from storage: online as normal, the downloaded copy when offline.
  event.respondWith(
    fetch(req).catch(() => caches.match(req.url, { cacheName: DOWNLOADS, ignoreVary: true })
      .then((hit) => hit || Response.error())),
  );
});
