// Minimal Service Worker for PWA installability
// No caching — just satisfies the browser's install requirements

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", () => {
  // Pass through — no caching
})
