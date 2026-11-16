// 旧 Service Worker（素通し）の置き換え用。
// 新しい SW は /serwist/sw.js から配信される。このファイルは、旧 SW が登録されたまま
// 新しいページをまだ開いていない端末を掃除するための自己解除 SW（O11 で削除予定）。
self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
      await self.registration.unregister()
    })()
  )
})
