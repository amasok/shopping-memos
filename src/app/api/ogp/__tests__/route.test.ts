import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// vi.hoisted でモック関数を先に定義（vi.mockのホイストに対応）
const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
}))

vi.mock("dns/promises", () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}))

// fetchをモック
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

import { GET } from "../route"

beforeEach(() => {
  vi.clearAllMocks()
})

function makeRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost/api/ogp?url=${encodeURIComponent(url)}`)
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

    it("http/https以外のスキームは400を返す", async () => {
      const req = makeRequest("ftp://example.com")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })
  })

  describe("SSRF対策", () => {
    it("ループバックIP（127.0.0.1）は400を返す", async () => {
      mockLookup.mockResolvedValue({ address: "127.0.0.1", family: 4 })
      const req = makeRequest("http://localhost/secret")
      const res = await GET(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain("Private IP")
    })

    it("プライベートIP（192.168.x.x）は400を返す", async () => {
      mockLookup.mockResolvedValue({ address: "192.168.1.1", family: 4 })
      const req = makeRequest("http://internal.local/")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })

    it("プライベートIP（10.x.x.x）は400を返す", async () => {
      mockLookup.mockResolvedValue({ address: "10.0.0.1", family: 4 })
      const req = makeRequest("http://internal.example.com/")
      const res = await GET(req)
      expect(res.status).toBe(400)
    })
  })

  describe("OGP取得成功", () => {
    it("OGPタグが含まれるHTMLからデータを返す", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 })
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
      const mockArrayBuffer = new TextEncoder().encode(html).buffer
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/html; charset=utf-8" },
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

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
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 })
      const html = `
        <html>
          <head>
            <meta content="Reversed Order Title" property="og:title" />
          </head>
        </html>
      `
      const mockArrayBuffer = new TextEncoder().encode(html).buffer
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/html" },
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      const req = makeRequest("https://example.com")
      const res = await GET(req)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe("Reversed Order Title")
    })
  })

  describe("エラーケース", () => {
    it("OGPタグがなくてもtitleタグがあれば200を返す（Amazon対応フォールバック）", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 })
      const html = `
        <html>
          <head>
            <title>商品名 | Amazon</title>
            <meta name="description" content="商品の説明文" />
          </head>
        </html>
      `
      const mockArrayBuffer = new TextEncoder().encode(html).buffer
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/html" },
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      const req = makeRequest("https://amazon.co.jp/dp/xxx")
      const res = await GET(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe("商品名 | Amazon")
      expect(body.description).toBe("商品の説明文")
    })

    it("AmazonのURLではdata-a-dynamic-imageから商品画像を取得する", async () => {
      mockLookup.mockResolvedValue({ address: "52.119.168.1", family: 4 })
      const html = `
        <html>
          <head>
            <title>商品名 | Amazon</title>
          </head>
          <body>
            <img data-a-dynamic-image="{&quot;https://example.com/img_300.jpg&quot;:[300,300],&quot;https://example.com/img_679.jpg&quot;:[679,679],&quot;https://example.com/img_425.jpg&quot;:[425,425]}" />
          </body>
        </html>
      `
      const mockArrayBuffer = new TextEncoder().encode(html).buffer
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/html" },
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      const req = makeRequest("https://www.amazon.co.jp/dp/B0DYNVL7B4")
      const res = await GET(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      // 最大幅（679px）の画像が選ばれる
      expect(body.image).toBe("https://example.com/img_679.jpg")
    })

    it("メタ情報が何もないHTMLは422を返す", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 })
      const html = "<html><body>本文のみ</body></html>"
      const mockArrayBuffer = new TextEncoder().encode(html).buffer
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/html" },
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      const req = makeRequest("https://example.com")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })

    it("HTML以外のContent-Typeは422を返す", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 })
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
      })

      const req = makeRequest("https://example.com/data.json")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })

    it("フェッチが失敗した場合は422を返す", async () => {
      mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 })
      mockFetch.mockResolvedValue({ ok: false })

      const req = makeRequest("https://example.com")
      const res = await GET(req)
      expect(res.status).toBe(422)
    })
  })
})
