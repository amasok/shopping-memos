// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest"
import { EmailConfigError, resolveEmailConfig } from "../env"
import { createEmailSender } from "../index"
import { ResendEmailSender } from "../ResendEmailSender"
import { ConsoleEmailSender } from "../ConsoleEmailSender"
import { TestMailboxEmailSender, getTestMailbox } from "../TestMailboxEmailSender"

const KEY = "re_test_dummy_key_for_unit_tests"
const FROM = "買い物メモ <noreply@mail.example.com>"
const E2E_TOKEN = "a".repeat(32)
const E2E_ENV = { E2E_TEST: "true", E2E_SEED_TOKEN: E2E_TOKEN }
const E2E_BUILD = { e2eBuild: true }

describe("メールの環境変数の検証と送り方の選択", () => {
  it("E2E_BUILD のビルドで E2E の実行時条件を満たすときは TestMailbox（Resend のキーがあっても送らない）", () => {
    expect(
      resolveEmailConfig({ ...E2E_ENV, RESEND_API_KEY: KEY, EMAIL_FROM: FROM }, E2E_BUILD).mode
    ).toBe("test")
    // オフライン E2E は本番ビルド（NODE_ENV=production）で動かす
    expect(resolveEmailConfig({ ...E2E_ENV, NODE_ENV: "production" }, E2E_BUILD).mode).toBe("test")
  })

  it("E2E_TEST があっても Vercel 上なら TestMailbox にしない", () => {
    expect(() => resolveEmailConfig({ ...E2E_ENV, VERCEL_ENV: "preview" }, E2E_BUILD)).toThrow(
      EmailConfigError
    )
  })

  it("E2E_BUILD でないビルドでは、E2E_TEST を誤って設定しても TestMailbox にしない", () => {
    const notE2EBuild = { e2eBuild: false }
    // 本番ビルドでキーがなければ、Map に入れて黙るのではなく起動時にエラーにする
    expect(() => resolveEmailConfig({ ...E2E_ENV, NODE_ENV: "production" }, notE2EBuild)).toThrow(
      /RESEND_API_KEY/
    )
    expect(
      resolveEmailConfig({ ...E2E_ENV, RESEND_API_KEY: KEY, EMAIL_FROM: FROM }, notE2EBuild).mode
    ).toBe("resend")
    expect(resolveEmailConfig(E2E_ENV, notE2EBuild).mode).toBe("console")
  })

  it("E2E_BUILD は既定でビルド時に埋め込まれた process.env.E2E_BUILD を読む", () => {
    vi.stubEnv("E2E_BUILD", "true")
    expect(resolveEmailConfig(E2E_ENV).mode).toBe("test")
    vi.stubEnv("E2E_BUILD", "false")
    expect(resolveEmailConfig(E2E_ENV).mode).toBe("console")
    vi.unstubAllEnvs()
  })

  it("RESEND_API_KEY と EMAIL_FROM があれば Resend", () => {
    expect(resolveEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: FROM, VERCEL_ENV: "preview" })).toEqual({
      mode: "resend",
      apiKey: KEY,
      from: FROM,
    })
  })

  it("本番では OTP_ALERT_EMAIL（送信数の監視の知らせの宛先。#61 A3b）が要る", () => {
    expect(() => resolveEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: FROM, VERCEL_ENV: "production" })).toThrow(
      /OTP_ALERT_EMAIL/
    )
    expect(
      resolveEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: FROM, VERCEL_ENV: "production", OTP_ALERT_EMAIL: "admin@example.com" })
    ).toMatchObject({ mode: "resend", alertEmail: "admin@example.com" })
  })

  it("EMAIL_FROM はアドレスだけでもよい", () => {
    expect(
      resolveEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: "noreply@mail.example.com" })
    ).toMatchObject({ mode: "resend", from: "noreply@mail.example.com" })
  })

  it("RESEND_API_KEY があって EMAIL_FROM がないとエラー", () => {
    expect(() => resolveEmailConfig({ RESEND_API_KEY: KEY })).toThrow(/EMAIL_FROM/)
  })

  it.each([
    "noreply",
    "買い物メモ <noreply>",
    "買い物メモ noreply@mail.example.com",
    "買い物\nBcc: x@example.com <noreply@mail.example.com>",
    "<noreply@mail.example.com",
  ])("EMAIL_FROM の形式が正しくない（%s）とエラー", (from) => {
    expect(() => resolveEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: from })).toThrow(/EMAIL_FROM/)
  })

  it.each([
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "preview" },
    { NODE_ENV: "production" },
  ])("本番・Vercel（%o）で RESEND_API_KEY がないと起動時にエラー", (env) => {
    expect(() => resolveEmailConfig(env)).toThrow(/RESEND_API_KEY/)
  })

  it("空の RESEND_API_KEY はないものとみなす", () => {
    expect(() => resolveEmailConfig({ RESEND_API_KEY: "  ", VERCEL_ENV: "production" })).toThrow(
      /RESEND_API_KEY/
    )
  })

  it("ローカルの開発（Vercel の development を含む）でキーがなければ Console にする", () => {
    expect(resolveEmailConfig({ NODE_ENV: "development" }).mode).toBe("console")
    expect(resolveEmailConfig({ VERCEL_ENV: "development" }).mode).toBe("console")
    expect(resolveEmailConfig({}).mode).toBe("console")
  })

  it("エラーのメッセージに環境変数の値を含めない", () => {
    try {
      resolveEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: "bad-from-value" })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY)
      expect((e as Error).message).not.toContain("bad-from-value")
    }
  })

  it("EMAIL_RECIPIENT_ALLOWLIST をカンマ区切りで読み、正規化する", () => {
    expect(
      resolveEmailConfig({ EMAIL_RECIPIENT_ALLOWLIST: " Taro@Example.com, hanako@example.com ,," }).allowlist
    ).toEqual(new Set(["taro@example.com", "hanako@example.com"]))
  })

  it("EMAIL_RECIPIENT_ALLOWLIST が未設定・空なら制限しない", () => {
    expect(resolveEmailConfig({}).allowlist).toBeUndefined()
    expect(resolveEmailConfig({ EMAIL_RECIPIENT_ALLOWLIST: " " }).allowlist).toBeUndefined()
  })

  it("EMAIL_RECIPIENT_ALLOWLIST に不正なアドレスがあるとエラー", () => {
    expect(() => resolveEmailConfig({ EMAIL_RECIPIENT_ALLOWLIST: "taro@example.com,nope" })).toThrow(
      /EMAIL_RECIPIENT_ALLOWLIST/
    )
  })

  it("OTP_ALERT_EMAIL を正規化して読み、不正ならエラー", () => {
    expect(resolveEmailConfig({ OTP_ALERT_EMAIL: "Admin@Example.com" }).alertEmail).toBe("admin@example.com")
    expect(resolveEmailConfig({}).alertEmail).toBeUndefined()
    expect(() => resolveEmailConfig({ OTP_ALERT_EMAIL: "admin" })).toThrow(/OTP_ALERT_EMAIL/)
  })
})

describe("createEmailSender", () => {
  afterEach(() => getTestMailbox().clear())

  it("設定に応じた実装を返す", () => {
    expect(createEmailSender({ RESEND_API_KEY: KEY, EMAIL_FROM: FROM })).toBeInstanceOf(ResendEmailSender)
    expect(createEmailSender({})).toBeInstanceOf(ConsoleEmailSender)
    expect(createEmailSender(E2E_ENV, { e2eBuild: true })).toBeInstanceOf(TestMailboxEmailSender)
    expect(createEmailSender(E2E_ENV, { e2eBuild: false })).toBeInstanceOf(ConsoleEmailSender)
  })

  it("本番でキーがなければエラー", () => {
    expect(() => createEmailSender({ VERCEL_ENV: "production" })).toThrow(EmailConfigError)
  })

  it("許可リストがあれば、リスト外には送らない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }))
    const sender = createEmailSender(
      { RESEND_API_KEY: KEY, EMAIL_FROM: FROM, EMAIL_RECIPIENT_ALLOWLIST: "taro@example.com" },
      { fetch: fetchMock, log: vi.fn() }
    )
    await sender.sendOtp({ to: "evil@example.com", otp: "123456", type: "sign-in" })
    expect(fetchMock).not.toHaveBeenCalled()
    await sender.sendOtp({ to: "taro@example.com", otp: "123456", type: "sign-in" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("許可リストは TestMailbox にもかかる", async () => {
    const sender = createEmailSender(
      { ...E2E_ENV, EMAIL_RECIPIENT_ALLOWLIST: "taro@example.com" },
      { log: vi.fn(), e2eBuild: true }
    )
    await sender.sendOtp({ to: "hanako@example.com", otp: "123456", type: "sign-in" })
    expect(getTestMailbox().latestOtp("hanako@example.com")).toBeUndefined()
  })

  it("Console にはログの出し先を渡せる", async () => {
    const log = vi.fn()
    await createEmailSender({}, { log }).sendOtp({ to: "taro@example.com", otp: "123456", type: "sign-in" })
    expect(log.mock.calls[0][0]).toContain("123456")
  })

  it("env を渡さなければ process.env を読む", () => {
    vi.stubEnv("E2E_BUILD", "")
    vi.stubEnv("VERCEL_ENV", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("E2E_TEST", "")
    vi.stubEnv("RESEND_API_KEY", "")
    vi.stubEnv("EMAIL_RECIPIENT_ALLOWLIST", "")
    vi.stubEnv("OTP_ALERT_EMAIL", "")
    expect(createEmailSender()).toBeInstanceOf(ConsoleEmailSender)
    vi.unstubAllEnvs()
  })
})
