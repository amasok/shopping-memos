/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist"
import { isStaleAppCache } from "@/lib/sw/config"
import { SKIP_WAITING_MESSAGE } from "@/lib/sw/version"
import { runtimeCaching } from "@/lib/sw/runtime-caching"

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // 新しい SW は waiting で待ち、利用者が［更新］を選んだとき（SKIP_WAITING）に有効にする。
  // kill switch のビルドは sw-kill.ts が配信されるので、自動で skipWaiting する
  skipWaiting: false,
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

self.addEventListener("message", (event) => {
  if (event.data?.type === SKIP_WAITING_MESSAGE) {
    void self.skipWaiting()
  }
})

serwist.addEventListeners()
