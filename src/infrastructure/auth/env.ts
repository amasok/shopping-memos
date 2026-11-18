import { z } from "@/shared/schemas/z"

/**
 * 認証の環境変数の確認（#61 A3a 0.3。design の D1・D4・D6）
 *
 * - 本番・Vercel（VERCEL_ENV が development 以外）か NODE_ENV=production では、すべて必須。欠けたら AuthConfigError
 *   （src/instrumentation.ts がサーバーの起動時に確かめる。ビルドでは確かめない）
 * - ローカルの開発では、欠けた値を開発用の値と Cloudflare の Turnstile のテスト用のキー（常に成功）で埋める
 * - 本番（VERCEL_ENV=production）では Turnstile のテスト用のキーを拒否する（Preview と E2E では使う）
 * - Vercel（production・preview）では、URL は https だけ（Cookie の Secure は baseURL の https で決まる）。
 *   CI・開発用の既知のダミー（not-for-production・dev-only を含む値）の secret・鍵も拒否する
 *
 * エラーのメッセージには環境変数の名前だけを書き、値は書かない
 */

type Env = Record<string, string | undefined>

export interface AuthEnv {
  secret: string
  /** アプリのオリジン（末尾の / なし） */
  baseURL: string
  /** baseURL と BETTER_AUTH_TRUSTED_ORIGINS（Preview のホストなど） */
  trustedOrigins: string[]
  otpEventHmacKey: string
  /** 非表示のウィジェット（secretKey・siteKey）と、狙われたアドレス用の対話型のウィジェット（challenge*。A3b） */
  turnstile: { secretKey: string; siteKey: string; challengeSecretKey: string; challengeSiteKey: string }
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthConfigError"
  }
}

export const DEV_AUTH_URL = "http://localhost:3000"
/** Cloudflare の Turnstile のテスト用のキー（常に成功する）。https://developers.cloudflare.com/turnstile/troubleshooting/testing/ */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA"
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"
// テスト用のキーは 1x・2x・3x で始まり、0 が続く
const TURNSTILE_TEST_KEY_PATTERN = /^[123]x0000/

const DEV_SECRET = "dev-only-better-auth-secret-do-not-use-in-production"
const DEV_OTP_EVENT_HMAC_KEY = "dev-only-otp-event-hmac-key-do-not-use-in-production"

const KEY_MIN_LENGTH = 32
/** CI・E2E・開発用のダミーの値に付けている印。Vercel で使われたら貼り間違い */
const DUMMY_MARKERS = /not-for-production|dev-only|e2e-ci-only|e2e-local/i

const blankToUndefined = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined))

/** オリジン（scheme://host[:port]）だけを受け付け、末尾の / を除く */
function toOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

const originSchema = z.string().transform((v, ctx) => {
  const origin = toOrigin(v)
  if (!origin) {
    ctx.addIssue({ code: "custom", message: "invalid" })
    return z.NEVER
  }
  return origin
})

const envSchema = z.object({
  BETTER_AUTH_SECRET: blankToUndefined.pipe(z.string().min(KEY_MIN_LENGTH).optional()),
  BETTER_AUTH_URL: blankToUndefined.pipe(originSchema.optional()),
  BETTER_AUTH_TRUSTED_ORIGINS: blankToUndefined.pipe(
    z
      .string()
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(originSchema))
      .optional()
  ),
  OTP_EVENT_HMAC_KEY: blankToUndefined.pipe(z.string().min(KEY_MIN_LENGTH).optional()),
  TURNSTILE_SECRET_KEY: blankToUndefined,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: blankToUndefined,
  TURNSTILE_CHALLENGE_SECRET_KEY: blankToUndefined,
  NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY: blankToUndefined,
})

function baseURLIsHttps(url: string | undefined): boolean {
  return url?.startsWith("https://") ?? false
}

function isDeployed(env: Env): boolean {
  return Boolean(env.VERCEL_ENV && env.VERCEL_ENV !== "development") || env.NODE_ENV === "production"
}

export function resolveAuthEnv(env: Env): AuthEnv {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))]
    throw new AuthConfigError(`認証の環境変数の値が正しくありません: ${names.join(", ")}`)
  }
  const v = parsed.data

  if (isDeployed(env)) {
    const required = {
      BETTER_AUTH_SECRET: v.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: v.BETTER_AUTH_URL,
      OTP_EVENT_HMAC_KEY: v.OTP_EVENT_HMAC_KEY,
      TURNSTILE_SECRET_KEY: v.TURNSTILE_SECRET_KEY,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: v.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      TURNSTILE_CHALLENGE_SECRET_KEY: v.TURNSTILE_CHALLENGE_SECRET_KEY,
      NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY: v.NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY,
    }
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([name]) => name)
    if (missing.length > 0) {
      throw new AuthConfigError(`本番・Vercel では次の環境変数が必要です: ${missing.join(", ")}`)
    }
  }

  const secret = v.BETTER_AUTH_SECRET ?? DEV_SECRET
  const otpEventHmacKey = v.OTP_EVENT_HMAC_KEY ?? DEV_OTP_EVENT_HMAC_KEY
  if (secret === otpEventHmacKey) {
    throw new AuthConfigError("OTP_EVENT_HMAC_KEY は BETTER_AUTH_SECRET と別の値にしてください")
  }

  const turnstile = {
    secretKey: v.TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_SECRET_KEY,
    siteKey: v.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY,
    challengeSecretKey: v.TURNSTILE_CHALLENGE_SECRET_KEY ?? TURNSTILE_TEST_SECRET_KEY,
    challengeSiteKey: v.NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY,
  }
  if (env.VERCEL_ENV === "production") {
    const testKeys = [
      ["TURNSTILE_SECRET_KEY", turnstile.secretKey],
      ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", turnstile.siteKey],
      ["TURNSTILE_CHALLENGE_SECRET_KEY", turnstile.challengeSecretKey],
      ["NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY", turnstile.challengeSiteKey],
    ].filter(([, key]) => TURNSTILE_TEST_KEY_PATTERN.test(key))
    if (testKeys.length > 0) {
      throw new AuthConfigError(
        `本番では Turnstile のテスト用のキーを使えません: ${testKeys.map(([name]) => name).join(", ")}`
      )
    }
    // 対話型のウィジェットは、非表示のものと別のウィジェットにする。同じだと、チャレンジの段階でも
    // 非表示のウィジェットのトークンが通ってしまう（61-a3b「チャレンジの段階では非表示のウィジェットのトークンを受け付けない」）
    const sameWidget = [
      turnstile.challengeSecretKey === turnstile.secretKey ? "TURNSTILE_CHALLENGE_SECRET_KEY" : null,
      turnstile.challengeSiteKey === turnstile.siteKey ? "NEXT_PUBLIC_TURNSTILE_CHALLENGE_SITE_KEY" : null,
    ].filter((name): name is string => name !== null)
    if (sameWidget.length > 0) {
      throw new AuthConfigError(
        `本番では、対話型のウィジェットを非表示のものと別にしてください: ${sameWidget.join(", ")}`
      )
    }
  }

  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    const bad: string[] = []
    if (!baseURLIsHttps(v.BETTER_AUTH_URL)) bad.push("BETTER_AUTH_URL")
    if ((v.BETTER_AUTH_TRUSTED_ORIGINS ?? []).some((o) => !o.startsWith("https://"))) {
      bad.push("BETTER_AUTH_TRUSTED_ORIGINS")
    }
    if (DUMMY_MARKERS.test(secret)) bad.push("BETTER_AUTH_SECRET")
    if (DUMMY_MARKERS.test(otpEventHmacKey)) bad.push("OTP_EVENT_HMAC_KEY")
    if (bad.length > 0) {
      throw new AuthConfigError(`Vercel では https の URL と本番用の鍵が必要です: ${bad.join(", ")}`)
    }
  }

  const baseURL = v.BETTER_AUTH_URL ?? DEV_AUTH_URL
  const trustedOrigins = [...new Set([baseURL, ...(v.BETTER_AUTH_TRUSTED_ORIGINS ?? [])])]

  return { secret, baseURL, trustedOrigins, otpEventHmacKey, turnstile }
}
