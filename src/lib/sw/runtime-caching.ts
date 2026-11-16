import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  StaleWhileRevalidate,
  type RuntimeCaching,
} from "serwist"
import { CACHE_NAMES } from "./config"

const DAY = 24 * 60 * 60

/** `/api/**` は allowlist 方式でキャッシュしない（認証・ユーザーデータを Cache Storage に残さない） */
export function isApiRequest(url: URL): boolean {
  return url.pathname === "/api" || url.pathname.startsWith("/api/")
}

export const runtimeCaching: RuntimeCaching[] = [
  // 先頭に置き、以降のどの matcher よりも優先して API を素通しにする
  {
    matcher: ({ url }) => isApiRequest(url),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ request, url, sameOrigin }) =>
      sameOrigin &&
      request.headers.get("RSC") === "1" &&
      !isApiRequest(url),
    handler: new NetworkFirst({
      cacheName: CACHE_NAMES.rsc,
      networkTimeoutSeconds: 3,
      plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 7 * DAY })],
    }),
  },
  {
    matcher: ({ request, sameOrigin, url }) =>
      sameOrigin && request.destination === "document" && !isApiRequest(url),
    handler: new NetworkFirst({
      cacheName: CACHE_NAMES.pages,
      networkTimeoutSeconds: 3,
      plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 7 * DAY })],
    }),
  },
  {
    // 他オリジンの画像は opaque レスポンス（容量を大きく数える）になるためキャッシュしない
    matcher: ({ request, sameOrigin }) =>
      sameOrigin && request.destination === "image",
    handler: new StaleWhileRevalidate({
      cacheName: CACHE_NAMES.images,
      plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * DAY })],
    }),
  },
  {
    matcher: ({ request, sameOrigin }) =>
      sameOrigin && request.destination === "font",
    handler: new CacheFirst({
      cacheName: CACHE_NAMES.fonts,
      plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 365 * DAY })],
    }),
  },
]
