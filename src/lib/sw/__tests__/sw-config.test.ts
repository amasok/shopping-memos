import { describe, it, expect } from "vitest"
import { CACHE_NAMES, CACHE_PREFIX, isStaleAppCache } from "../config"
import { isApiRequest, runtimeCaching } from "../runtime-caching"

describe("SW のキャッシュ設定", () => {
  it("ランタイムキャッシュ名に CACHE_VERSION の接頭辞が付く", () => {
    for (const name of Object.values(CACHE_NAMES)) {
      expect(name.startsWith(CACHE_PREFIX)).toBe(true)
    }
    expect(CACHE_PREFIX).toBe("sm-v1-")
  })

  it("現在のバージョン以外の sm- キャッシュだけが削除対象になる", () => {
    expect(isStaleAppCache("sm-v0-pages")).toBe(true)
    expect(isStaleAppCache("sm-pages")).toBe(true)
    expect(isStaleAppCache(CACHE_NAMES.pages)).toBe(false)
    expect(isStaleAppCache("serwist-precache-v2")).toBe(false)
    expect(isStaleAppCache("other-cache")).toBe(false)
  })

  it.each([
    "/api/trpc/items.list",
    "/api/auth/session",
    "/api/e2e/seed",
    "/api/test/x",
    "/api/ogp",
    "/api/version",
    "/api",
  ])("%s は API として扱う", (path) => {
    expect(isApiRequest(new URL(path, "https://example.com"))).toBe(true)
  })

  it("API 以外は API として扱わない", () => {
    expect(isApiRequest(new URL("/apiary", "https://example.com"))).toBe(false)
    expect(isApiRequest(new URL("/lists", "https://example.com"))).toBe(false)
  })

  it("先頭の matcher が /api/** を捕まえ、RSC・document の matcher は /api/** を除外する", () => {
    const origin = "https://example.com"
    const mk = (path: string, init: { dest?: string; rsc?: boolean }) => {
      const url = new URL(path, origin)
      const headers = new Headers(init.rsc ? { RSC: "1" } : {})
      const request = { destination: init.dest ?? "", headers } as unknown as Request
      return { url, request, sameOrigin: true } as never
    }
    const first = runtimeCaching[0].matcher as (o: never) => boolean
    expect(first(mk("/api/trpc/x", { rsc: true }))).toBe(true)
    expect(first(mk("/lists", {}))).toBe(false)
    for (const rt of runtimeCaching.slice(1, 3)) {
      const m = rt.matcher as (o: never) => boolean
      expect(m(mk("/api/auth/session", { dest: "document", rsc: true }))).toBe(false)
    }
  })
})
