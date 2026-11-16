import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// vi.hoisted でモック関数を先に定義（vi.mockのホイストに対応）
const { mockLookup, mockRequestPinned } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
  mockRequestPinned: vi.fn(),
}))

vi.mock("dns/promises", () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}))

// 検証済み IP に固定した HTTP リクエストをモック
vi.mock("../http-client", () => ({
  requestPinned: mockRequestPinned,
}))

import { Readable } from "stream"
import { GET } from "../route"
import { ogpRateLimiter } from "../rate-limit"

const mockFetch = mockRequestPinned

beforeEach(() => {
  vi.clearAllMocks()
  ogpRateLimiter.reset()
})

/** dns.lookup(host, { all: true }) の戻り値を組み立てるヘルパー */
function resolvedTo(address: string, family = 4) {
  return [{ address, family }]
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost/api/ogp?url=${encodeURIComponent(url)}`)
}

/** requestPinned モックのレスポンス（IncomingMessage 相当）を組み立てるヘルパー */
function mockResponse(
  statusCode: number,
  headers: Record<string, string> = {},
  body = ""
) {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers })
}

function mockHtmlResponse(html: string, contentType = "text/html") {
  return mockResponse(200, { "content-type": contentType }, html)
}

describe("GET /api/ogp", () => {
  describe("URLバリデーション", () => {
    it("urlパラメータがない場合は400を返す", async () => {
      const req = new NextRequest("http://localhost/api/ogp")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })

    it("不正なURLは400を返す", async () => {
      const req = makeRequest("not-a-url")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })

    it("2048文字を超えるURLは取得せずに400を返す", async () => {
      const res = await GET(makeRequest(`https://example.com/${"a".repeat(2048)}`))
      expect(res.status).toBe(400)
      expect(mockLookup).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("http/https以外のスキームは400を返す", async () => {
      const req = makeRequest("ftp://example.com")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })
  })

  describe("SSRF対策", () => {
    it("ループバックIP（127.0.0.1）は400を返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("127.0.0.1"))
      const req = makeRequest("http://localhost/secret")
      const res = await GET(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain("Private IP")
    })

    it("プライベートIP（192.168.x.x）は400を返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("192.168.1.1"))
      const req = makeRequest("http://internal.local/")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })

    it("プライベートIP（10.x.x.x）は400を返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("10.0.0.1"))
      const req = makeRequest("http://internal.example.com/")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })
  })

  describe("OGP取得成功", () => {
    it("OGPタグが含まれるHTMLからデータを返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("93.184.216.34"))
      const html = `
        <html>
          <head>
            <meta property="og:title" content="Example Domain" />
            <meta property="og:description" content="This is an example." />
            <meta property="og:image" content="https://example.com/og.png" />
            <meta property="og:site_name" content="Example" />
          </head>
        </html>
      `
      mockFetch.mockResolvedValue(mockHtmlResponse(html, "text/html; charset=utf-8"))

      const req = makeRequest("https://example.com")
      const res = await GET(req)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe("Example Domain")
      expect(body.description).toBe("This is an example.")
      expect(body.image).toBe("https://example.com/og.png")
      expect(body.siteName).toBe("Example")
    })

    it("contentとpropertyの順番が逆でも正しくパースする", async () => {
      mockLookup.mockResolvedValue(resolvedTo("93.184.216.34"))
      const html = `
        <html>
          <head>
            <meta content="Reversed Order Title" property="og:title" />
          </head>
        </html>
      `
      mockFetch.mockResolvedValue(mockHtmlResponse(html))

      const req = makeRequest("https://example.com")
      const res = await GET(req)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe("Reversed Order Title")
    })
  })

  describe("エラーケース", () => {
    it("AmazonのURLは422を返す（OGP取得非対応）", async () => {
      mockLookup.mockResolvedValue(resolvedTo("52.119.168.1"))

      const req = makeRequest("https://www.amazon.co.jp/dp/B0DYNVL7B4")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })

    it("amzn.asiaのURLも422を返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("52.119.168.1"))

      const req = makeRequest("https://amzn.asia/d/xxxxxxx")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })

    it("メタ情報が何もないHTMLは422を返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("93.184.216.34"))
      const html = "<html><body>本文のみ</body></html>"
      mockFetch.mockResolvedValue(mockHtmlResponse(html))

      const req = makeRequest("https://example.com")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })

    it("HTML以外のContent-Typeは422を返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("93.184.216.34"))
      mockFetch.mockResolvedValue(mockResponse(200, { "content-type": "application/json" }))

      const req = makeRequest("https://example.com/data.json")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })

    it("フェッチが失敗した場合は422を返す", async () => {
      mockLookup.mockResolvedValue(resolvedTo("93.184.216.34"))
      mockFetch.mockResolvedValue(mockResponse(404))

      const req = makeRequest("https://example.com")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })
  })
})

describe("GET /api/ogp: 読み込む大きさの上限", () => {
  /** 64KB ずつ流れてくる応答（実際のストリームに近づける） */
  function chunkedHtmlResponse(html: string) {
    const buf = Buffer.from(html)
    const chunks: Buffer[] = []
    for (let i = 0; i < buf.length; i += 64 * 1024) chunks.push(buf.subarray(i, i + 64 * 1024))
    return Object.assign(Readable.from(chunks), {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  const OG_TAGS = `<meta property="og:title" content="動画のタイトル"><meta property="og:image" content="https://i.ytimg.com/vi/x/hq.jpg">`

  it("<head> のスクリプトが大きく og タグが 800KB 付近にあるページ（YouTube）でも取得できる", async () => {
    mockLookup.mockResolvedValue(resolvedTo("142.250.196.110"))
    const script = `<script>var ytInitialData = "${"x".repeat(800 * 1024)}";</script>`
    mockFetch.mockResolvedValueOnce(chunkedHtmlResponse(`<html><head>${script}${OG_TAGS}</head><body></body></html>`))

    const res = await GET(makeRequest("https://www.youtube.com/watch?v=abc"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe("動画のタイトル")
    expect(body.image).toBe("https://i.ytimg.com/vi/x/hq.jpg")
  })

  it("上限（2MiB）より後ろにある og タグは読まない", async () => {
    mockLookup.mockResolvedValue(resolvedTo("93.184.216.34"))
    const padding = "x".repeat(2 * 1024 * 1024)
    mockFetch.mockResolvedValueOnce(chunkedHtmlResponse(`<html><head><script>${padding}</script>${OG_TAGS}</head></html>`))

    const res = await GET(makeRequest("https://example.com/huge"))

    expect(res.status).toBe(422)
  })
})
