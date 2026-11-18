// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { SITEVERIFY_URL, TURNSTILE_ACTION, verifyTurnstileToken } from "../turnstile"

const REAL_ENV = {
  turnstile: {
    secretKey: "0x4AAAAAAA-real-secret",
    siteKey: "0x4AAAAAAA-real-site",
    challengeSecretKey: "0x4AAAAAAA-challenge-secret",
    challengeSiteKey: "0x4AAAAAAA-challenge-site",
  },
  trustedOrigins: ["https://shopping.counoco.net", "https://preview-shopping-memos.vercel.app"],
}

function siteverify(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))
}

const OK = { success: true, hostname: "shopping.counoco.net", action: TURNSTILE_ACTION }

describe("Turnstile の siteverify（#61 A3a 2.4）", () => {
  it("Turnstile の確認に成功したら送る", async () => {
    const fetchMock = siteverify(OK)
    await expect(
      verifyTurnstileToken({ token: "tok", remoteIp: "203.0.113.1", challenge: false, env: REAL_ENV, fetch: fetchMock })
    ).resolves.toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(SITEVERIFY_URL)
    const form = init!.body as URLSearchParams
    expect(form.get("secret")).toBe("0x4AAAAAAA-real-secret")
    expect(form.get("response")).toBe("tok")
    expect(form.get("remoteip")).toBe("203.0.113.1")
    expect(init!.signal).toBeInstanceOf(AbortSignal)
  })

  it("チャレンジの段階では、チャレンジ用の secret でだけ確かめる（#61 A3b）", async () => {
    const fetchMock = siteverify(OK)
    await verifyTurnstileToken({ token: "tok", remoteIp: "unknown", challenge: true, env: REAL_ENV, fetch: fetchMock })
    expect((fetchMock.mock.calls[0][1]!.body as URLSearchParams).get("secret")).toBe("0x4AAAAAAA-challenge-secret")
  })

  it("チャレンジの段階でなければ、非表示のウィジェットの secret で確かめる", async () => {
    const fetchMock = siteverify(OK)
    await verifyTurnstileToken({ token: "tok", remoteIp: "unknown", challenge: false, env: REAL_ENV, fetch: fetchMock })
    expect((fetchMock.mock.calls[0][1]!.body as URLSearchParams).get("secret")).toBe("0x4AAAAAAA-real-secret")
  })

  it("Preview のホストのトークンも受け付ける（trustedOrigins のホスト）", async () => {
    const fetchMock = siteverify({ ...OK, hostname: "preview-shopping-memos.vercel.app" })
    await expect(
      verifyTurnstileToken({ token: "tok", remoteIp: "unknown", challenge: false, env: REAL_ENV, fetch: fetchMock })
    ).resolves.toBe(true)
    expect((fetchMock.mock.calls[0][1]!.body as URLSearchParams).has("remoteip")).toBe(false)
  })

  describe("Turnstile の確認に失敗したら送らない", () => {
    it.each([null, ""])("トークンがない（%o）と、siteverify を呼ばずに失敗", async (token) => {
      const fetchMock = siteverify(OK)
      await expect(
        verifyTurnstileToken({ token, remoteIp: "unknown", challenge: false, env: REAL_ENV, fetch: fetchMock })
      ).resolves.toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("長すぎるトークンは失敗", async () => {
      await expect(
        verifyTurnstileToken({ token: "x".repeat(2049), remoteIp: "unknown", challenge: false, env: REAL_ENV, fetch: siteverify(OK) })
      ).resolves.toBe(false)
    })

    it.each([
      [{ success: false, hostname: "shopping.counoco.net", action: TURNSTILE_ACTION }, 200],
      [OK, 500],
    ])("siteverify が失敗（%o・%i）なら失敗", async (body, status) => {
      await expect(
        verifyTurnstileToken({ token: "tok", remoteIp: "unknown", challenge: false, env: REAL_ENV, fetch: siteverify(body, status) })
      ).resolves.toBe(false)
    })

    it("通信できなければ失敗", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => {
        throw new TypeError("network")
      })
      await expect(
        verifyTurnstileToken({ token: "tok", remoteIp: "unknown", challenge: false, env: REAL_ENV, fetch: fetchMock })
      ).resolves.toBe(false)
    })
  })

  describe("別のホストや別の action のトークンでは送らない", () => {
    it.each([
      { ...OK, hostname: "evil.example.com" },
      { ...OK, hostname: undefined },
      { ...OK, action: "login" },
      { ...OK, action: undefined },
    ])("%o は失敗", async (body) => {
      await expect(
        verifyTurnstileToken({ token: "tok", remoteIp: "unknown", challenge: false, env: REAL_ENV, fetch: siteverify(body) })
      ).resolves.toBe(false)
    })
  })

  it("テスト用の secret は、ネットワークに出ずに Cloudflare の決まりどおりに返す（1x は成功、2x・3x は失敗）", async () => {
    const fetchMock = siteverify(OK)
    const env = (secretKey: string) => ({
      ...REAL_ENV,
      turnstile: { ...REAL_ENV.turnstile, secretKey, siteKey: "1x00000000000000000000AA" },
    })
    await expect(
      verifyTurnstileToken({ token: "XXXX.DUMMY.TOKEN.XXXX", remoteIp: "unknown", challenge: false, env: env("1x0000000000000000000000000000000AA"), fetch: fetchMock })
    ).resolves.toBe(true)
    await expect(
      verifyTurnstileToken({ token: "XXXX.DUMMY.TOKEN.XXXX", remoteIp: "unknown", challenge: false, env: env("2x0000000000000000000000000000000AA"), fetch: fetchMock })
    ).resolves.toBe(false)
    await expect(
      verifyTurnstileToken({ token: null, remoteIp: "unknown", challenge: false, env: env("1x0000000000000000000000000000000AA"), fetch: fetchMock })
    ).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
