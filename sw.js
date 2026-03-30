// ============================================================
//  IHC MAINTENANCE APP – Safe Service Worker
//  File: sw.js
// ============================================================

const CACHE_NAME = "ihc-mtto-v3";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Network-first, fallback to cache
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Never cache API calls to Google Apps Script
  if (url.hostname.includes("script.google.com") || url.search.includes("payload")) {
    return; 
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
