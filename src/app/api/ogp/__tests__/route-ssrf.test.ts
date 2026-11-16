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

const PUBLIC_IP = "93.184.216.34"
const HTML = `<meta property="og:title" content="タイトル">`

const resolvedTo = (address: string, family = 4) => [{ address, family }]
const makeRequest = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/ogp?url=${encodeURIComponent(url)}`, { headers })
const response = (statusCode: number, headers: Record<string, string> = {}, body = "") =>
  Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers })
const redirect = (location: string, status = 302) => response(status, { location })
const ok = () => response(200, { "content-type": "text/html" }, HTML)

beforeEach(() => {
  vi.clearAllMocks()
  mockLookup.mockReset()
  mockRequestPinned.mockReset()
  ogpRateLimiter.reset()
  mockLookup.mockResolvedValue(resolvedTo(PUBLIC_IP))
})

describe("GET /api/ogp: リダイレクト先の検証 (#66)", () => {
  it("内部IPに解決されるホストへのリダイレクトは400で、2回目の接続をしない", async () => {
    mockLookup.mockImplementation(async (host: string) =>
      resolvedTo(host === "internal.example" ? "10.0.0.5" : PUBLIC_IP)
    )
    mockRequestPinned.mockResolvedValueOnce(redirect("http://internal.example/admin"))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).toHaveBeenCalledTimes(1)
  })

  it("メタデータ用IP（169.254.169.254）へのリダイレクトは400", async () => {
    mockRequestPinned.mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data/"))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).toHaveBeenCalledTimes(1)
  })

  it("ループバックの IPv6 リテラルへのリダイレクトは400", async () => {
    mockRequestPinned.mockResolvedValueOnce(redirect("http://[::1]/"))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).toHaveBeenCalledTimes(1)
  })

  it("ftp: へのリダイレクトは400で、2回目の接続をしない", async () => {
    mockRequestPinned.mockResolvedValueOnce(redirect("ftp://example.com/file"))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).toHaveBeenCalledTimes(1)
  })

  it(":8080 へのリダイレクトは400で、2回目の接続をしない", async () => {
    mockRequestPinned.mockResolvedValueOnce(redirect("http://example.com:8080/"))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).toHaveBeenCalledTimes(1)
  })

  it("認証情報つきURLへのリダイレクトは400", async () => {
    mockRequestPinned.mockResolvedValueOnce(redirect("http://user:pass@example.com/"))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).toHaveBeenCalledTimes(1)
  })

  it("リダイレクトが5回までなら追従して取得できる", async () => {
    for (let i = 1; i <= 5; i++) mockRequestPinned.mockResolvedValueOnce(redirect(`/r${i}`))
    mockRequestPinned.mockResolvedValueOnce(ok())

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(200)
    expect(mockRequestPinned).toHaveBeenCalledTimes(6)
  })

  it("リダイレクトが6回を超えたら422", async () => {
    mockRequestPinned.mockImplementation(async () => redirect("/loop"))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(422)
    expect(mockRequestPinned).toHaveBeenCalledTimes(6)
  })

  it("Location がないリダイレクトは422", async () => {
    mockRequestPinned.mockResolvedValueOnce(response(302))

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(422)
  })

  it("相対 Location を元のURLを基準に解決して追従する", async () => {
    mockRequestPinned.mockResolvedValueOnce(redirect("/moved/page?x=1"))
    mockRequestPinned.mockResolvedValueOnce(ok())

    const res = await GET(makeRequest("https://start.example/old/path"))

    expect(res.status).toBe(200)
    const secondUrl = mockRequestPinned.mock.calls[1][0] as URL
    expect(secondUrl.href).toBe("https://start.example/moved/page?x=1")
  })

  it("別ホストへの絶対 Location は、そのホストを名前解決して検証してから接続する", async () => {
    mockLookup.mockImplementation(async (host: string) =>
      resolvedTo(host === "other.example" ? "1.1.1.1" : PUBLIC_IP)
    )
    mockRequestPinned.mockResolvedValueOnce(redirect("https://other.example/final"))
    mockRequestPinned.mockResolvedValueOnce(ok())

    const res = await GET(makeRequest("https://start.example/"))

    expect(res.status).toBe(200)
    expect(mockLookup).toHaveBeenCalledWith("other.example", expect.anything())
    expect((mockRequestPinned.mock.calls[1][1] as { address: string }).address).toBe("1.1.1.1")
  })
})

describe("GET /api/ogp: 検証済みIPへの固定 (#66)", () => {
  it("requestPinned には lookup で検証したアドレスが渡される", async () => {
    mockLookup.mockResolvedValue(resolvedTo("8.8.4.4"))
    mockRequestPinned.mockResolvedValueOnce(ok())

    await GET(makeRequest("https://example.com/page"))

    const [url, pinned] = mockRequestPinned.mock.calls[0] as [URL, { address: string; family: number }]
    expect(url.href).toBe("https://example.com/page")
    expect(pinned).toEqual({ address: "8.8.4.4", family: 4 })
  })

  it("1リクエストの名前解決は1ホップにつき1回だけ（接続時に再解決しない前提）", async () => {
    mockRequestPinned.mockResolvedValueOnce(ok())

    await GET(makeRequest("https://example.com/"))

    expect(mockLookup).toHaveBeenCalledTimes(1)
  })

  it("500 のリトライは同じ検証済みアドレスに接続し、再度名前解決しない", async () => {
    mockRequestPinned.mockResolvedValueOnce(response(503))
    mockRequestPinned.mockResolvedValueOnce(ok())

    const res = await GET(makeRequest("https://example.com/"))

    expect(res.status).toBe(200)
    expect(mockLookup).toHaveBeenCalledTimes(1)
    expect(mockRequestPinned.mock.calls[1][1]).toEqual(mockRequestPinned.mock.calls[0][1])
  })

  it("複数レコードのうち1件でもプライベートなら400で、接続しない", async () => {
    mockLookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: "192.168.0.10", family: 4 },
    ])

    const res = await GET(makeRequest("https://rebind.example/"))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).not.toHaveBeenCalled()
  })

  it("IPv6 の公開アドレスは family 6 で固定される", async () => {
    mockLookup.mockResolvedValue(resolvedTo("2606:4700:4700::1111", 6))
    mockRequestPinned.mockResolvedValueOnce(ok())

    await GET(makeRequest("https://example.com/"))

    expect(mockRequestPinned.mock.calls[0][1]).toEqual({ address: "2606:4700:4700::1111", family: 6 })
  })
})

describe("GET /api/ogp: 初回URLの検証 (#66)", () => {
  it.each([
    ["http://example.com:8080/"],
    ["https://example.com:8443/"],
    ["ftp://example.com/"],
    ["file:///etc/passwd"],
    ["http://user:pass@example.com/"],
    ["http://[::1]/"],
    ["http://0.0.0.0/"],
    ["http://100.64.0.1/"],
    ["http://198.18.0.1/"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://[::ffff:127.0.0.1]/"],
    ["http://[fd00::1]/"],
  ])("%s は400で、接続しない", async (url) => {
    const res = await GET(makeRequest(url))

    expect(res.status).toBe(400)
    expect(mockRequestPinned).not.toHaveBeenCalled()
  })
})

describe("GET /api/ogp: レート制限 (#66)", () => {
  it("同一IPの61回目のリクエストは429で Retry-After を返し、接続しない", async () => {
    mockRequestPinned.mockImplementation(async () => ok())
    const headers = { "x-real-ip": "198.51.100.7" }

    for (let i = 0; i < 60; i++) {
      const res = await GET(makeRequest("https://example.com/", headers))
      expect(res.status).toBe(200)
    }
    const calls = mockRequestPinned.mock.calls.length
    const limited = await GET(makeRequest("https://example.com/", headers))

    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBe("60")
    expect(mockRequestPinned.mock.calls.length).toBe(calls)
  })

  it("別のIPは影響を受けない", async () => {
    mockRequestPinned.mockImplementation(async () => ok())

    for (let i = 0; i < 61; i++) await GET(makeRequest("https://example.com/", { "x-real-ip": "198.51.100.7" }))
    const other = await GET(makeRequest("https://example.com/", { "x-real-ip": "198.51.100.8" }))

    expect(other.status).toBe(200)
  })

  it("バリデーションエラーのリクエストもレート制限を消費する", async () => {
    const headers = { "x-real-ip": "198.51.100.9" }

    for (let i = 0; i < 60; i++) await GET(makeRequest("not-a-url", headers))
    const res = await GET(makeRequest("not-a-url", headers))

    expect(res.status).toBe(429)
  })
})
