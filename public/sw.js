/* SmartILR Service Worker — Phase 2 PWA
   Strategy: cache-first for static assets, network-first for API calls */

const CACHE_NAME = "smartilr-v17";
const STATIC_ASSETS = [
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.svg",
  "/icon-512.svg",
  "/apple-touch-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always network-first for API and LV routes
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/lv/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Always network-first for HTML — ensures page updates are instant
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for other static assets (icons, manifest, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
