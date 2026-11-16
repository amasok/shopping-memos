/// <reference lib="esnext" />
/// <reference lib="webworker" />
// kill switch 段階 2: 自己消去する SW。IndexedDB には触れない（未送信の変更を守る）
export {}

declare const self: ServiceWorkerGlobalScope

self.addEventListener("install", () => {
  void self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: "window" })
      await Promise.all(clients.map((c) => c.navigate(c.url).catch(() => null)))
    })()
  )
})
