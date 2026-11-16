/** キャッシュ名の接頭辞。互換性のない変更をしたら CACHE_VERSION を上げる */
export const CACHE_VERSION = "v1"
export const CACHE_PREFIX = `sm-${CACHE_VERSION}-`

export const CACHE_NAMES = {
  pages: `${CACHE_PREFIX}pages`,
  rsc: `${CACHE_PREFIX}rsc`,
  images: `${CACHE_PREFIX}images`,
  fonts: `${CACHE_PREFIX}fonts`,
} as const

/** アプリシェルとしてプリキャッシュするページ */
export const APP_SHELL_URLS = [
  "/",
  "/lists",
  "/lists/new",
  "/lists/detail",
  "/items/new",
  "/history",
  "/tags",
  "/settings",
  "/groups",
  "/login",
  "/~offline",
] as const

/** 現在のバージョン以外の `sm-` キャッシュ名か（削除対象） */
export function isStaleAppCache(name: string): boolean {
  return name.startsWith("sm-") && !name.startsWith(CACHE_PREFIX)
}
