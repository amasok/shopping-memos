// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { ALLOWED_AUTH_PATHS, createAuthRouteHandler } from "../route"

const ORIGIN = "https://shopping.counoco.net"

function setup() {
  const handle = vi.fn(async () => new Response("{}", { status: 200 }))
  const route = createAuthRouteHandler({ handle, trustedOrigins: () => [ORIGIN] })
  return { handle, route }
}

function post(path: string, body: unknown = {}, headers: Record<string, string> = { origin: ORIGIN }) {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("認証の route（#61 A3a 3.2）", () => {
  it.each([
    "/sign-up/email",
    "/sign-in/email",
    "/sign-in/social",
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/forget-password/email-otp",
    "/email-otp/reset-password",
  ])("許可していないパスは 404 になる（%s。Better Auth に渡さない）", async (path) => {
    const { handle, route } = setup()
    const res = await route(post(path, { email: "a@example.com", password: "x", otp: "123456" }))
    expect(res.status).toBe(404)
    expect(handle).not.toHaveBeenCalled()
  })

  it.each([
    ["GET", "/sign-in/email-otp"],
    ["POST", "/get-session"],
    ["GET", "/list-sessions"],
    ["POST", "/sign-in/email-otp/"],
    ["POST", "/email-otp%2Fsend-verification-otp"],
  ])("メソッドとパスの組が許可リストにない（%s %s）と 404", async (method, path) => {
    const { handle, route } = setup()
    const res = await route(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method,
        headers: { origin: ORIGIN },
        body: method === "POST" ? "{}" : undefined,
      })
    )
    expect(res.status).toBe(404)
    expect(handle).not.toHaveBeenCalled()
  })

  it("ログイン以外の種類のコードの送信は断る", async () => {
    const { handle, route } = setup()
    for (const type of ["email-verification", "forget-password", "change-email", undefined]) {
      const res = await route(post("/email-otp/send-verification-otp", { email: "a@example.com", type }))
      expect(res.status).toBe(400)
    }
    const broken = await route(
      new Request(`${ORIGIN}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: { origin: ORIGIN },
        body: "not json",
      })
    )
    expect(broken.status).toBe(400)
    expect(handle).not.toHaveBeenCalled()
  })

  it("許可したパスは動く", async () => {
    const { handle, route } = setup()
    expect((await route(post("/email-otp/send-verification-otp", { email: "a@example.com", type: "sign-in" }))).status).toBe(200)
    expect((await route(post("/sign-in/email-otp", { email: "a@example.com", otp: "123456" }))).status).toBe(200)
    expect((await route(post("/sign-out"))).status).toBe(200)
    expect((await route(new Request(`${ORIGIN}/api/auth/get-session`))).status).toBe(200)
    expect(handle).toHaveBeenCalledTimes(4)
    // 送信の本文は Better Auth にそのまま渡る（clone して読んでいる）
    const sent = handle.mock.calls[0] as unknown as [Request]
    expect(await sent[0].json()).toEqual({ email: "a@example.com", type: "sign-in" })
  })

  it("許可リストは送信・照合・セッション・ログアウトだけ", () => {
    expect(ALLOWED_AUTH_PATHS).toEqual({
      GET: ["/get-session"],
      POST: ["/email-otp/send-verification-otp", "/sign-in/email-otp", "/sign-out"],
    })
  })

  it("別のオリジンからのログインは 403 になる", async () => {
    const { handle, route } = setup()
    const res = await route(post("/sign-in/email-otp", { email: "a@example.com", otp: "123456" }, { origin: "https://evil.example.com" }))
    expect(res.status).toBe(403)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(handle).not.toHaveBeenCalled()
  })

  it("Origin が null のリクエストは 403 になる", async () => {
    const { handle, route } = setup()
    for (const path of ["/sign-in/email-otp", "/email-otp/send-verification-otp", "/sign-out"]) {
      const res = await route(post(path, { email: "a@example.com", otp: "1", type: "sign-in" }, { origin: "null" }))
      expect(res.status).toBe(403)
    }
    expect(handle).not.toHaveBeenCalled()
  })

  it("Sec-Fetch-Site が cross-site の POST は 403", async () => {
    const { route } = setup()
    const res = await route(post("/sign-out", {}, { "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(403)
  })

  it("GET（セッションの取得）はオリジンを確かめない", async () => {
    const { route } = setup()
    const res = await route(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { origin: "https://evil.example.com" } }))
    expect(res.status).toBe(200)
  })
})
