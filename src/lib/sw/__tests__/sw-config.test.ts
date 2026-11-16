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

  it("画像・フォントは同一オリジンのものだけキャッシュする（opaque レスポンスを保存しない）", () => {
    const mk = (dest: string, sameOrigin: boolean) =>
      ({
        url: new URL("https://example.com/a"),
        request: { destination: dest, headers: new Headers() },
        sameOrigin,
      }) as never
    for (const dest of ["image", "font"]) {
      const rt = runtimeCaching.find((r) =>
        (r.matcher as (o: never) => boolean)(mk(dest, true))
      )
      expect(rt).toBeDefined()
      expect((rt!.matcher as (o: never) => boolean)(mk(dest, false))).toBe(false)
    }
  })
})

describe("画像・フォントのキャッシュは status 200 のみ保存する (#62 O1)", () => {
  type Plugin = { cacheWillUpdate?: (o: { response: Response }) => Promise<Response | null> }
  const mk = (dest: string) =>
    ({
      url: new URL("https://example.com/a"),
      request: { destination: dest, headers: new Headers() },
      sameOrigin: true,
    }) as never

  it.each(["image", "font"])("%s のキャッシュは 200 だけを保存し、404 / 206 は保存しない（opaque は status 0 なので対象外）", async (dest) => {
    const rt = runtimeCaching.find((r) => (r.matcher as (o: never) => boolean)(mk(dest)))!
    const plugins = (rt.handler as unknown as { plugins: Plugin[] }).plugins
    const check = plugins.find((p) => p.cacheWillUpdate)!.cacheWillUpdate!

    expect(await check({ response: new Response("x", { status: 200 }) })).not.toBeNull()
    expect(await check({ response: new Response("x", { status: 404 }) })).toBeNull()
    expect(await check({ response: new Response(null, { status: 206 }) })).toBeNull()
  })
})
