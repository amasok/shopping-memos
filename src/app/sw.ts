/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist"
import { isStaleAppCache } from "@/lib/sw/config"
import { runtimeCaching } from "@/lib/sw/runtime-caching"

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // O1b で更新通知を入れるまでは、新しい SW をすぐ有効にする
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
})

// 現在のバージョン以外の sm- キャッシュだけを削除する（他のキャッシュには触れない）
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter(isStaleAppCache).map((n) => caches.delete(n)))
      )
  )
})

serwist.addEventListeners()
