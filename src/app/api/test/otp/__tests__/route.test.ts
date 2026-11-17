// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest"
import { GET } from "../route.e2e"
import { getTestMailbox, resolveEmailConfig } from "@/infrastructure/auth/email"
import { TestMailboxEmailSender } from "@/infrastructure/auth/email/TestMailboxEmailSender"
import { getPageExtensions } from "@/lib/e2e/guard"

/**
 * E2E 用のテスト用のルート（#61 A3a 5.1）
 */
const TOKEN = "t".repeat(64)

function request(email: string | null, token: string | null = TOKEN) {
  const url = new URL("http://localhost:3000/api/test/otp")
  if (email !== null) url.searchParams.set("email", email)
  return new Request(url, { headers: token === null ? {} : { "x-e2e-token": token } })
}

function enable(extra: Record<string, string> = {}) {
  vi.stubEnv("E2E_TEST", "true")
  vi.stubEnv("E2E_SEED_TOKEN", TOKEN)
  vi.stubEnv("VERCEL_ENV", "")
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v)
}

afterEach(() => {
  vi.unstubAllEnvs()
  getTestMailbox().clear()
})

describe("E2E 用のテスト用のルート", () => {
  it("条件がそろうとテスト用のルートが直近のコードを返す", async () => {
    enable()
    const sender = new TestMailboxEmailSender()
    await sender.sendOtp({ to: "taro@e2e-test.local", otp: "111111", type: "sign-in" })
    await sender.sendOtp({ to: "taro@e2e-test.local", otp: "222222", type: "sign-in" })

    const res = await GET(request(" Taro@E2E-Test.local "))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body.otp).toBe("222222")
    expect(new Date(body.sentAt).getTime()).toBeLessThanOrEqual(new Date(body.now).getTime())
  })

  it("まだ送っていなければ otp は null", async () => {
    enable()
    const body = await (await GET(request("nobody@e2e-test.local"))).json()
    expect(body).toMatchObject({ otp: null, sentAt: null })
  })

  it("アドレスが正しくなければ 400", async () => {
    enable()
    expect((await GET(request("nope"))).status).toBe(400)
    expect((await GET(request(null))).status).toBe(400)
  })

  it.each([
    ["E2E_TEST がない", { E2E_TEST: "" }, TOKEN],
    ["VERCEL_ENV が production", { VERCEL_ENV: "production" }, TOKEN],
    ["VERCEL_ENV が preview", { VERCEL_ENV: "preview" }, TOKEN],
    ["トークンがない", {}, null],
    ["トークンが違う", {}, "x".repeat(64)],
  ])("条件が 1 つでも欠けるとテスト用のルートは 404 になる（%s）", async (_label, env, token) => {
    enable(env as Record<string, string>)
    await new TestMailboxEmailSender().sendOtp({ to: "taro@e2e-test.local", otp: "123456", type: "sign-in" })
    const res = await GET(request("taro@e2e-test.local", token as string | null))
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain("123456")
  })

  it("本番のビルドの NODE_ENV でも条件がそろえばテスト用のルートが動く", async () => {
    enable({ NODE_ENV: "production" })
    await new TestMailboxEmailSender().sendOtp({ to: "taro@e2e-test.local", otp: "654321", type: "sign-in" })
    const res = await GET(request("taro@e2e-test.local"))
    expect(res.status).toBe(200)
    expect((await res.json()).otp).toBe("654321")
  })

  it("E2E_BUILD なしのビルドではコードを手元に持たない（ルートはビルドに含まれず、送り方は通常のもの）", () => {
    // ルートのファイル（route.e2e.ts）は E2E_BUILD のビルドだけの pageExtensions
    expect(getPageExtensions({})).not.toContain("e2e.ts")
    expect(getPageExtensions({ E2E_BUILD: "true" })).toContain("e2e.ts")
    // 実行時に E2E_TEST をそろえても、E2E_BUILD のないビルドでは TestMailbox にしない
    const env = { E2E_TEST: "true", E2E_SEED_TOKEN: TOKEN }
    expect(resolveEmailConfig({ ...env, NODE_ENV: "development" }, { e2eBuild: false }).mode).toBe("console")
    expect(resolveEmailConfig({ ...env, RESEND_API_KEY: "re_x", EMAIL_FROM: "a@example.com" }, { e2eBuild: false }).mode).toBe("resend")
  })
})
