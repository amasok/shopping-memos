// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest"
import { assertAuthEnvAtStartup } from "../startup"
import { AuthConfigError } from "../env"
import { EmailConfigError } from "../email/env"
import { register } from "@/instrumentation"

const PROD_AUTH_ENV = {
  VERCEL_ENV: "production",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "https://shopping.counoco.net",
  OTP_EVENT_HMAC_KEY: "h".repeat(32),
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-secret",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-real-site",
}

describe("起動時の環境変数の確認（#61 A3a 0.3）", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("本番で認証の環境変数が欠けると起動を止める", () => {
    expect(() => assertAuthEnvAtStartup({ VERCEL_ENV: "production" })).toThrow(AuthConfigError)
  })

  it("本番で RESEND_API_KEY が欠けると起動を止める", () => {
    expect(() => assertAuthEnvAtStartup(PROD_AUTH_ENV)).toThrow(EmailConfigError)
  })

  it("本番ですべてそろっていれば通る", () => {
    expect(() =>
      assertAuthEnvAtStartup({
        ...PROD_AUTH_ENV,
        RESEND_API_KEY: "re_dummy",
        EMAIL_FROM: "noreply@mail.counoco.net",
      })
    ).not.toThrow()
  })

  it("ローカルの開発では、何も設定しなくても通る", () => {
    expect(() => assertAuthEnvAtStartup({ NODE_ENV: "development" })).not.toThrow()
  })

  it("register は Node.js のランタイムでだけ確かめる", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("BETTER_AUTH_SECRET", "")
    vi.stubEnv("NEXT_RUNTIME", "edge")
    await expect(register()).resolves.toBeUndefined()
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    await expect(register()).rejects.toThrow(AuthConfigError)
  })
})
