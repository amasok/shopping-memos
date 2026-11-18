// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  AuthConfigError,
  DEV_AUTH_URL,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
  resolveAuthEnv,
} from "../env"

const SECRET = "s".repeat(32)
const HMAC = "h".repeat(32)
const PROD_ENV = {
  VERCEL_ENV: "production",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "https://shopping.counoco.net",
  OTP_EVENT_HMAC_KEY: HMAC,
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-secret",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-real-site",
  TURNSTILE_CHALLENGE_SECRET_KEY: "0x4AAAAAAA-real-challenge-secret",
  NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY: "0x4AAAAAAA-real-challenge-site",
}

describe("認証の環境変数の確認（#61 A3a 0.3）", () => {
  it("本番ですべてそろっていれば、その値を返す", () => {
    expect(resolveAuthEnv(PROD_ENV)).toEqual({
      secret: SECRET,
      baseURL: "https://shopping.counoco.net",
      trustedOrigins: ["https://shopping.counoco.net"],
      otpEventHmacKey: HMAC,
      turnstile: {
        secretKey: "0x4AAAAAAA-real-secret",
        siteKey: "0x4AAAAAAA-real-site",
        challengeSecretKey: "0x4AAAAAAA-real-challenge-secret",
        challengeSiteKey: "0x4AAAAAAA-real-challenge-site",
      },
    })
  })

  it.each([
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "OTP_EVENT_HMAC_KEY",
    "TURNSTILE_SECRET_KEY",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_CHALLENGE_SECRET_KEY",
    "NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY",
  ])("本番で %s が欠けると、名前を挙げてエラーにする", (name) => {
    expect(() => resolveAuthEnv({ ...PROD_ENV, [name]: "" })).toThrow(
      new RegExp(name)
    )
  })

  it.each([{ VERCEL_ENV: "preview" }, { NODE_ENV: "production" }])(
    "Vercel の Preview や NODE_ENV=production（%o）でも、欠けるとエラーにする",
    (env) => {
      expect(() => resolveAuthEnv(env)).toThrow(AuthConfigError)
    }
  )

  it.each(["BETTER_AUTH_SECRET", "OTP_EVENT_HMAC_KEY"])("%s が 32 文字より短いとエラーにする", (name) => {
    expect(() => resolveAuthEnv({ ...PROD_ENV, [name]: "short" })).toThrow(new RegExp(name))
  })

  it("BETTER_AUTH_SECRET と OTP_EVENT_HMAC_KEY が同じ値だとエラーにする（鍵を使い回さない）", () => {
    expect(() => resolveAuthEnv({ ...PROD_ENV, OTP_EVENT_HMAC_KEY: SECRET })).toThrow(/OTP_EVENT_HMAC_KEY/)
  })

  it.each(["shopping.counoco.net", "ftp://shopping.counoco.net", "https://shopping.counoco.net/login"])(
    "BETTER_AUTH_URL がオリジンでない（%s）とエラーにする",
    (url) => {
      expect(() => resolveAuthEnv({ ...PROD_ENV, BETTER_AUTH_URL: url })).toThrow(/BETTER_AUTH_URL/)
    }
  )

  it("BETTER_AUTH_URL の末尾の / は除く", () => {
    expect(resolveAuthEnv({ ...PROD_ENV, BETTER_AUTH_URL: "https://shopping.counoco.net/" }).baseURL).toBe(
      "https://shopping.counoco.net"
    )
  })

  it("BETTER_AUTH_TRUSTED_ORIGINS をカンマ区切りで読み、BETTER_AUTH_URL に足す", () => {
    const env = resolveAuthEnv({
      ...PROD_ENV,
      VERCEL_ENV: "preview",
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
      TURNSTILE_CHALLENGE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
      NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
      BETTER_AUTH_TRUSTED_ORIGINS: " https://a-shopping-memos.vercel.app , https://b-shopping-memos.vercel.app/ ,",
    })
    expect(env.trustedOrigins).toEqual([
      "https://shopping.counoco.net",
      "https://a-shopping-memos.vercel.app",
      "https://b-shopping-memos.vercel.app",
    ])
  })

  it("BETTER_AUTH_TRUSTED_ORIGINS にオリジンでない値があるとエラーにする", () => {
    expect(() =>
      resolveAuthEnv({ ...PROD_ENV, BETTER_AUTH_TRUSTED_ORIGINS: "https://ok.example.com,*.vercel.app" })
    ).toThrow(/BETTER_AUTH_TRUSTED_ORIGINS/)
  })

  it.each(["production", "preview"])("Vercel（%s）では http の URL を拒否する（Cookie の Secure が付かなくなるため）", (vercelEnv) => {
    const base = { ...PROD_ENV, VERCEL_ENV: vercelEnv }
    expect(() => resolveAuthEnv({ ...base, BETTER_AUTH_URL: "http://shopping.counoco.net" })).toThrow(/BETTER_AUTH_URL/)
    expect(() => resolveAuthEnv({ ...base, BETTER_AUTH_TRUSTED_ORIGINS: "http://preview.example.com" })).toThrow(
      /BETTER_AUTH_TRUSTED_ORIGINS/
    )
  })

  it("NODE_ENV=production だけ（ローカルの E2E）では http://localhost を受け付ける", () => {
    const env = resolveAuthEnv({ ...PROD_ENV, VERCEL_ENV: "", NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:43123" })
    expect(env.baseURL).toBe("http://localhost:43123")
  })

  it.each([
    ["BETTER_AUTH_SECRET", "e2e-ci-only-better-auth-secret-not-for-production"],
    ["OTP_EVENT_HMAC_KEY", "dev-only-otp-event-hmac-key-do-not-use-in-production"],
  ])("Vercel では CI・開発用のダミーの %s を拒否する（貼り間違い）", (name, value) => {
    expect(() => resolveAuthEnv({ ...PROD_ENV, [name]: value })).toThrow(new RegExp(name))
  })

  it("本番（VERCEL_ENV=production）では Turnstile のテスト用のキーを拒否する", () => {
    expect(() =>
      resolveAuthEnv({ ...PROD_ENV, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY })
    ).toThrow(/TURNSTILE_SECRET_KEY/)
    expect(() =>
      resolveAuthEnv({ ...PROD_ENV, NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY })
    ).toThrow(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/)
    expect(() =>
      resolveAuthEnv({ ...PROD_ENV, TURNSTILE_CHALLENGE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY })
    ).toThrow(/TURNSTILE_CHALLENGE_SECRET_KEY/)
    expect(() =>
      resolveAuthEnv({ ...PROD_ENV, NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY: TURNSTILE_TEST_SITE_KEY })
    ).toThrow(/NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY/)
  })

  it.each([
    ["TURNSTILE_CHALLENGE_SECRET_KEY", "0x4AAAAAAA-real-secret"],
    ["NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY", "0x4AAAAAAA-real-site"],
  ])("本番では、対話型のウィジェット（%s）が非表示のものと同じ値ならエラーにする（#61 A3b）", (name, value) => {
    expect(() => resolveAuthEnv({ ...PROD_ENV, [name]: value })).toThrow(new RegExp(name))
  })

  it("ローカルの開発で欠けていれば、開発用の値と Turnstile のテスト用のキーにする", () => {
    const env = resolveAuthEnv({ NODE_ENV: "development" })
    expect(env.baseURL).toBe(DEV_AUTH_URL)
    expect(env.trustedOrigins).toEqual([DEV_AUTH_URL])
    expect(env.secret.length).toBeGreaterThanOrEqual(32)
    expect(env.otpEventHmacKey.length).toBeGreaterThanOrEqual(32)
    expect(env.otpEventHmacKey).not.toBe(env.secret)
    expect(env.turnstile).toEqual({
      secretKey: TURNSTILE_TEST_SECRET_KEY,
      siteKey: TURNSTILE_TEST_SITE_KEY,
      challengeSecretKey: TURNSTILE_TEST_SECRET_KEY,
      challengeSiteKey: TURNSTILE_TEST_SITE_KEY,
    })
  })

  it("ローカルの開発でも、設定した値はそのまま使う", () => {
    expect(resolveAuthEnv({ BETTER_AUTH_URL: "http://localhost:4123" }).baseURL).toBe("http://localhost:4123")
  })

  it("エラーのメッセージに値を含めない", () => {
    try {
      resolveAuthEnv({ ...PROD_ENV, BETTER_AUTH_SECRET: "too-short-secret-value" })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain("too-short-secret-value")
    }
  })
})
