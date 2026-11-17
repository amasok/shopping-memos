// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest"

/**
 * tRPC の route のオリジンの確認と、Better Auth のセッションからの context（#61 A3a 3.3）
 *
 * getAuth はモックする（実 DB でのセッションの確認は better-auth.db.test.ts）
 */
const getSession = vi.fn()
vi.mock("@/infrastructure/auth/server", () => ({
  getAuth: vi.fn(async () => ({ api: { getSession } })),
}))

const { POST, GET } = await import("@/app/api/trpc/[trpc]/route")
const { createContext } = await import("../server")

// テストの環境（NODE_ENV=test）では、信頼するオリジンは開発用の http://localhost:3000
const APP_ORIGIN = "http://localhost:3000"

function mutation(headers: Record<string, string>) {
  return new Request(`${APP_ORIGIN}/api/trpc/identity.createGroup`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "better-auth.session_token=tok", ...headers },
    body: JSON.stringify({ json: { name: "家族" } }),
  })
}

describe("tRPC の route（#61 A3a 3.3）", () => {
  beforeEach(() => {
    getSession.mockReset()
    getSession.mockResolvedValue(null)
  })

  it("別のオリジンからの mutation は 403 になる", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", name: "", email: "a@example.com", image: null } })
    const res = await POST(mutation({ origin: "https://evil.example.com" }))
    expect(res.status).toBe(403)
    // 処理に進まない（セッションも読まない）
    expect(getSession).not.toHaveBeenCalled()
  })

  it("Origin が null のリクエストは 403 になる", async () => {
    const res = await POST(mutation({ origin: "null" }))
    expect(res.status).toBe(403)
  })

  it("Sec-Fetch-Site が cross-site の mutation は 403 になる", async () => {
    const res = await POST(mutation({ "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(403)
  })

  it("同じオリジンからの mutation は処理される（セッションがなければ tRPC の UNAUTHORIZED）", async () => {
    const res = await POST(mutation({ origin: APP_ORIGIN, "sec-fetch-site": "same-origin" }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.json.data.code).toBe("UNAUTHORIZED")
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it("セッションがないと保護された API は 401 になる", async () => {
    const res = await GET(new Request(`${APP_ORIGIN}/api/trpc/identity.getGroups`))
    expect(res.status).toBe(401)
  })

  it("GET（query）はオリジンを確かめない", async () => {
    const res = await GET(
      new Request(`${APP_ORIGIN}/api/trpc/identity.getGroups`, { headers: { origin: "https://evil.example.com" } })
    )
    expect(res.status).toBe(401)
  })
})

describe("createContext（#61 A3a 3.3）", () => {
  beforeEach(() => getSession.mockReset())

  it("セッションがあれば、そのユーザーの ID と情報を入れる", async () => {
    getSession.mockResolvedValue({ user: { id: "u1", name: "花子", email: "h@example.com", image: null } })
    const req = new Request(`${APP_ORIGIN}/api/trpc/x`, { headers: { cookie: "better-auth.session_token=tok" } })
    await expect(createContext({ req })).resolves.toEqual({
      userId: "u1",
      user: { id: "u1", name: "花子", email: "h@example.com", image: null },
    })
    expect(getSession.mock.calls[0][0].headers).toBe(req.headers)
  })

  it("セッションがなければ空", async () => {
    getSession.mockResolvedValue(null)
    await expect(createContext({ req: new Request(`${APP_ORIGIN}/api/trpc/x`) })).resolves.toEqual({})
  })

  it("リクエストがなければ空（セッションを読まない）", async () => {
    await expect(createContext()).resolves.toEqual({})
    expect(getSession).not.toHaveBeenCalled()
  })
})
