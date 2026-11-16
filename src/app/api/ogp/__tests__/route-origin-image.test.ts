import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { Readable } from "stream"

const { mockLookup, mockRequestPinned } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
  mockRequestPinned: vi.fn(),
}))

vi.mock("dns/promises", () => ({ default: { lookup: mockLookup }, lookup: mockLookup }))
vi.mock("../http-client", () => ({ requestPinned: mockRequestPinned }))

import { GET } from "../route"
import { ogpRateLimiter } from "../rate-limit"

const html = (image: string) =>
  `<meta property="og:title" content="タイトル"><meta property="og:image" content="${image}">`
const response = (statusCode: number, headers: Record<string, string> = {}, body = "") =>
  Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers })
const page = (image: string) => response(200, { "content-type": "text/html" }, html(image))

const makeRequest = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/ogp?url=${encodeURIComponent(url)}`, { headers })

beforeEach(() => {
  vi.clearAllMocks()
  mockLookup.mockReset()
  mockRequestPinned.mockReset()
  ogpRateLimiter.reset()
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
})

describe("GET /api/ogp: 同一オリジンの確認 (#66)", () => {
  beforeEach(() => {
    mockRequestPinned.mockImplementation(async () => page("https://example.com/a.png"))
  })

  it.each([["same-origin"], ["none"]])("Sec-Fetch-Site: %s は許可する", async (site) => {
    const res = await GET(makeRequest("https://example.com/", { "sec-fetch-site": site }))

    expect(res.status).toBe(200)
  })

  it.each([["cross-site"], ["same-site"], ["unknown"], [""]])(
    "Sec-Fetch-Site: %s は403で、接続しない",
    async (site) => {
      const res = await GET(makeRequest("https://example.com/", { "sec-fetch-site": site }))

      expect(res.status).toBe(403)
      expect(mockRequestPinned).not.toHaveBeenCalled()
      expect(mockLookup).not.toHaveBeenCalled()
    }
  )

  it("Sec-Fetch-Site がなく、他サイトの Origin なら403", async () => {
    const res = await GET(makeRequest("https://example.com/", { origin: "https://evil.example" }))

    expect(res.status).toBe(403)
    expect(mockRequestPinned).not.toHaveBeenCalled()
  })

  it("Sec-Fetch-Site がなく、自分の Origin なら許可する", async () => {
    const res = await GET(makeRequest("https://example.com/", { origin: "http://localhost" }))

    expect(res.status).toBe(200)
  })

  it("Origin のポートやスキームが違えば403", async () => {
    const res = await GET(makeRequest("https://example.com/", { origin: "http://localhost:3001" }))

    expect(res.status).toBe(403)
  })

  it("どちらのヘッダーもない（ブラウザ以外のクライアント）場合は許可する", async () => {
    const res = await GET(makeRequest("https://example.com/"))

    expect(res.status).toBe(200)
  })

  it("Sec-Fetch-Site があれば Origin より優先する（cross-site は Origin が自分でも403）", async () => {
    const res = await GET(
      makeRequest("https://example.com/", { "sec-fetch-site": "cross-site", origin: "http://localhost" })
    )

    expect(res.status).toBe(403)
  })

  it("403 のリクエストはレート制限を消費しない（判定がレート制限より前）", async () => {
    const headers = { "x-real-ip": "198.51.100.20", "sec-fetch-site": "cross-site" }

    for (let i = 0; i < 70; i++) {
      const res = await GET(makeRequest("https://example.com/", headers))
      expect(res.status).toBe(403)
    }
    const allowed = await GET(
      makeRequest("https://example.com/", { "x-real-ip": "198.51.100.20", "sec-fetch-site": "same-origin" })
    )

    expect(allowed.status).toBe(200)
  })
})

describe("GET /api/ogp: og:image の URL (#66)", () => {
  it.each([
    ["/img.png", "https://example.com/dir/page", "https://example.com/img.png"],
    ["img.png", "https://example.com/dir/page", "https://example.com/dir/img.png"],
    ["//cdn.example/x.png", "https://example.com/dir/page", "https://cdn.example/x.png"],
    ["https://img.example/a.png", "https://example.com/", "https://img.example/a.png"],
  ])("og:image %s を絶対URL（%s 基準）にして返す", async (image, pageUrl, expected) => {
    mockRequestPinned.mockResolvedValueOnce(page(image))

    const res = await GET(makeRequest(pageUrl))

    expect((await res.json()).image).toBe(expected)
  })

  it("リダイレクト後は、最終URLを基準に相対パスを解決する", async () => {
    mockRequestPinned.mockResolvedValueOnce(response(301, { location: "https://final.example/new/place" }))
    mockRequestPinned.mockResolvedValueOnce(page("thumb.png"))

    const res = await GET(makeRequest("https://start.example/old"))

    const body = await res.json()
    expect(body.image).toBe("https://final.example/new/thumb.png")
    // 返す url はリクエストされた URL のまま
    expect(body.url).toBe("https://start.example/old")
  })

  it("javascript: の og:image は返さない", async () => {
    mockRequestPinned.mockResolvedValueOnce(page("javascript:alert(1)"))

    const res = await GET(makeRequest("https://example.com/"))

    const body = await res.json()
    expect(body.image).toBeUndefined()
    expect(body.title).toBe("タイトル")
  })

  it("data: の og:image は返さない", async () => {
    mockRequestPinned.mockResolvedValueOnce(page("data:image/png;base64,AAAA"))

    const res = await GET(makeRequest("https://example.com/"))

    expect((await res.json()).image).toBeUndefined()
  })
})
