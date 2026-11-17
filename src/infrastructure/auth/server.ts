import { createHmac, hkdfSync, randomUUID } from "node:crypto"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { nextCookies } from "better-auth/next-js"
import { emailOTP } from "better-auth/plugins/email-otp"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { and, count, eq, gt } from "drizzle-orm"
import * as schema from "@/infrastructure/db/drizzle/schema"
import { OtpEventRepository } from "@/modules/identity/infrastructure/OtpEventRepository"
import { createEmailSender, resolveEmailConfig, type EmailSender } from "./email"
import { resolveAuthEnv, type AuthEnv } from "./env"
import { clientIpForTurnstile, clientIpKey, IPV6_SUBNET, CLIENT_IP_HEADERS } from "./ip"
import { readOtpEmail } from "./otpEmail"

/**
 * Better Auth の本体（#61 A3a 2.x。change 61-a3-email-otp-login の design の D1・D3〜D5）
 *
 * 最初に使うときに作る（getAuth）。モジュールの読み込みで作ると、`next build` が環境変数の確認で落ちるため（A1 の申し送り）。
 * Auth.js（index.ts）は、置き換えが終わる 5.5 まで並べて残す
 */

type Db = PostgresJsDatabase<typeof schema>

export const SEND_OTP_PATH = "/email-otp/send-verification-otp"
export const SIGN_IN_OTP_PATH = "/sign-in/email-otp"

/** IP ごとの上限（D4）。1 分の分は Better Auth の rateLimit、24 時間の分は otp_events で数える（rateLimit は 1 つのパスに 1 つの窓しか持てない） */
export const IP_LIMITS = {
  sendPerMinute: 3,
  sendPerDay: 20,
  verifyPerMinute: 10,
} as const

/** Turnstile のヘッダ（ログイン画面が付ける。2.4） */
export const TURNSTILE_TOKEN_HEADER = "x-turnstile-token"

/** Better Auth の既定の API のうち、A3a で使わないもの（route の許可リスト（3.2）と重ねてかける。D4） */
export const DISABLED_PATHS = [
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/social",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/update-user",
  "/delete-user",
  "/change-email",
  "/change-password",
  "/set-password",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/verify-email",
  "/email-otp/verify-email",
  "/email-otp/check-verification-otp",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
]

export interface TurnstileCheck {
  /** Turnstile のトークンを siteverify で確かめる。確かめられなければ false */
  (input: { token: string | null; remoteIp: string; challenge: boolean }): Promise<boolean>
}

export interface AuthDeps {
  db: Db
  env: AuthEnv
  emailSender: EmailSender
  otpEvents: OtpEventRepository
  verifyTurnstile: TurnstileCheck
  /** EMAIL_RECIPIENT_ALLOWLIST（Preview だけ）。外のアドレスには黙って送らない（新しいコードも作らない） */
  recipientAllowlist?: ReadonlySet<string>
  /** メールの送信を応答と切り離す（Next.js の after）。なければ送り終わるまで待つ */
  runInBackground?: (task: Promise<unknown>) => void
  now?: () => Date
}

/** OTP を DB に持つときのハッシュ（D1）。BETTER_AUTH_SECRET から用途のラベルを付けて HKDF で鍵を導出し、HMAC-SHA256 にする */
export function createOtpHasher(secret: string): (otp: string) => Promise<string> {
  const key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "shopping-memos:otp-hash", 32))
  return async (otp) => createHmac("sha256", key).update(otp).digest("base64url")
}

function badRequest(code: string, message: string): never {
  throw new APIError("BAD_REQUEST", { code, message })
}

/**
 * 本文を、許したキーだけにして書き換える。hooks.before から { context: { body } } を返すと、
 * Better Auth は元の本文と混ぜる（defu）ので、余計なキー（name・image など）が残る。そのため本文そのものを書き換える
 */
function replaceBody(ctx: { body?: unknown }, next: Record<string, string>): void {
  const body = ctx.body as Record<string, unknown>
  for (const key of Object.keys(body)) delete body[key]
  Object.assign(body, next)
}

export function createAuth(deps: AuthDeps) {
  const now = deps.now ?? (() => new Date())
  const { env } = deps

  /**
   * そのアドレスに期限内のコードがあるか。Better Auth は期限切れの検証の行を、ほかのリクエストのついでに全体から消すので、
   * 期限切れのコードを入れたときに「不一致」になることがある。行がなければ照合に進まず、期限切れと同じ応答にする
   */
  async function hasLiveOtp(email: string): Promise<boolean> {
    const rows = await deps.db
      .select({ id: schema.authVerifications.id })
      .from(schema.authVerifications)
      .where(
        and(
          eq(schema.authVerifications.identifier, `sign-in-otp-${email}`),
          gt(schema.authVerifications.expiresAt, new Date())
        )
      )
      .limit(1)
    return rows.length > 0
  }

  /** IP ごとの 24 時間の送信の上限（otp_events の sent を IP で数える） */
  async function sentFromIpToday(ip: string): Promise<number> {
    const since = new Date(now().getTime() - 24 * 60 * 60 * 1000)
    const [row] = await deps.db
      .select({ n: count() })
      .from(schema.otpEvents)
      .where(and(eq(schema.otpEvents.kind, "sent"), eq(schema.otpEvents.ip, ip), gt(schema.otpEvents.createdAt, since)))
    return row?.n ?? 0
  }

  const before = createAuthMiddleware(async (ctx) => {
    if (ctx.path === SEND_OTP_PATH) {
      if (typeof ctx.body !== "object" || ctx.body === null) badRequest("INVALID_EMAIL", "Invalid email")
      const body = ctx.body as Record<string, unknown>
      if (body.type !== "sign-in") badRequest("INVALID_OTP_TYPE", "Invalid OTP type")
      const email = readOtpEmail(body)
      if (!email) badRequest("INVALID_EMAIL", "Invalid email")

      const headers = ctx.headers ?? new Headers()
      const ip = clientIpKey(headers)
      // アドレスに依存しない理由（Turnstile・IP の上限）は、その旨を返してよい（specs「送信の結果でアドレスの存在が分からない」）
      // Cloudflare には丸める前の訪問者の IP を渡す（/64 に丸めたキーではなく）
      const turnstileOk = await deps.verifyTurnstile({
        token: headers.get(TURNSTILE_TOKEN_HEADER),
        remoteIp: clientIpForTurnstile(headers),
        challenge: false,
      })
      if (!turnstileOk) {
        throw new APIError("FORBIDDEN", { code: "TURNSTILE_FAILED", message: "Bot check failed" })
      }
      if ((await sentFromIpToday(ip)) >= IP_LIMITS.sendPerDay) {
        throw new APIError("TOO_MANY_REQUESTS", { code: "RATE_LIMITED", message: "Too many requests" })
      }

      // アドレスに結びつく理由は、送ったときと同じ応答で黙って見送る（新しいコードも作らない）
      const silent = { success: true }
      if (deps.recipientAllowlist && !deps.recipientAllowlist.has(email)) return silent
      const decision = await deps.otpEvents.guardSend(email, ip, now())
      if (decision.kind === "silent") return silent

      replaceBody(ctx, { email, type: "sign-in" })
      return
    }

    if (ctx.path === SIGN_IN_OTP_PATH) {
      if (typeof ctx.body !== "object" || ctx.body === null) badRequest("INVALID_EMAIL", "Invalid email")
      const body = ctx.body as Record<string, unknown>
      const email = readOtpEmail(body)
      if (!email) badRequest("INVALID_EMAIL", "Invalid email")
      const otp = typeof body.otp === "string" ? body.otp : ""

      // コードがない（期限切れで消えた・使った・送っていない）なら、照合として数えずに期限切れと同じ応答
      if (!(await hasLiveOtp(email))) {
        throw new APIError("BAD_REQUEST", { code: "OTP_EXPIRED", message: "OTP expired" })
      }
      const ip = clientIpKey(ctx.headers ?? new Headers())
      const decision = await deps.otpEvents.guardVerify(email, ip, now())
      if (decision.kind === "reject") {
        if (decision.reason === "locked") {
          throw new APIError("FORBIDDEN", { code: "OTP_LOCKED", message: "Too many failed attempts" })
        }
        // 1 つのコードの 3 回を超えた: Better Auth の 3 回まちがえたときと同じ応答
        throw new APIError("FORBIDDEN", { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts" })
      }
      // name・image などは受け付けない（新しいユーザーは name ''。表示名は A4）
      replaceBody(ctx, { email, otp })
      return
    }
  })

  const after = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_IN_OTP_PATH || !ctx.context.newSession) return
    // hooks.before で正規化した本文のアドレス（照合に使ったもの）を使う
    const email = readOtpEmail(ctx.body)
    if (!email) return
    await deps.otpEvents.recordUnlocked(email, clientIpKey(ctx.headers ?? new Headers()), now())
  })

  return betterAuth({
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(deps.db, {
      provider: "pg",
      schema: {
        users: schema.users,
        authSessions: schema.authSessions,
        authAccounts: schema.authAccounts,
        authVerifications: schema.authVerifications,
        rateLimits: schema.rateLimits,
      },
    }),
    user: { modelName: "users", fields: { emailVerified: "emailVerifiedFlag" } },
    account: { modelName: "authAccounts" },
    verification: { modelName: "authVerifications" },
    session: {
      modelName: "authSessions",
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // cookieCache は使わない（ログアウト・失効をすぐ効かせる。D5）
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      customRules: {
        [SEND_OTP_PATH]: { window: 60, max: IP_LIMITS.sendPerMinute },
        [SIGN_IN_OTP_PATH]: { window: 60, max: IP_LIMITS.verifyPerMinute },
        // セッションの取得は Cookie を読むだけ（トークンは推測できない長さ）なので数えない。
        // 画面はフォーカスのたびなどに呼ぶので、IP が取れないとき（共有のキー）に枠を使い切ると、ログインしていない扱いになる
        "/get-session": false,
      },
    },
    disabledPaths: DISABLED_PATHS,
    advanced: {
      database: { generateId: () => randomUUID() },
      ipAddress: { ipAddressHeaders: [...CLIENT_IP_HEADERS], ipv6Subnet: IPV6_SUBNET },
      ...(deps.runInBackground ? { backgroundTasks: { handler: deps.runInBackground } } : {}),
    },
    hooks: { before, after },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        // 既定は平文。"hashed" は塩なしの SHA-256 で 6 桁はすぐ割り出せるので、鍵付きの HMAC にする（D1）
        storeOTP: { hash: createOtpHasher(env.secret) },
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return
          await deps.emailSender.sendOtp({ to: email, otp, type })
        },
      }),
      // 必ず最後。Next.js のリクエストの外（テスト）では何もしない
      nextCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let cached: Auth | undefined

/** 本番・開発で使う Better Auth（最初に呼んだときに作る） */
export async function getAuth(): Promise<Auth> {
  if (cached) return cached
  const [{ db }, { after }, { verifyTurnstileToken }] = await Promise.all([
    import("@/infrastructure/db/drizzle/client"),
    import("next/server"),
    import("./turnstile"),
  ])
  const env = resolveAuthEnv(process.env)
  const emailConfig = resolveEmailConfig(process.env)
  cached = createAuth({
    db,
    env,
    emailSender: createEmailSender(),
    otpEvents: new OtpEventRepository(db, env.otpEventHmacKey),
    verifyTurnstile: (input) => verifyTurnstileToken({ ...input, env }),
    recipientAllowlist: emailConfig.allowlist,
    runInBackground: (task) => {
      try {
        after(task)
      } catch {
        // リクエストの外（起動時のスクリプトなど）では待たずに流す。失敗は Better Auth がログに出す
      }
    },
  })
  return cached
}
