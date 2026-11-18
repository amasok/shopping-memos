import { isE2ERuntimeEnabled } from "@/lib/e2e/guard"
import { normalizeEmail } from "@/shared/schemas/email"
import { z } from "@/shared/schemas/z"

/**
 * メールの環境変数の検証と送り方の選択（#61 A1）
 *
 * 1. E2E_BUILD=true のビルドで、E2E の実行時条件（E2E_TEST・VERCEL_ENV・E2E_SEED_TOKEN）を満たす → TestMailbox
 *    （#70 と同じ二重の守り。本番ビルドで E2E_TEST を誤って設定しても、メールが Map に入って届かない状態にしない）
 * 2. RESEND_API_KEY がある → Resend（EMAIL_FROM も必須）
 * 3. Vercel 上（VERCEL_ENV が development 以外）か NODE_ENV=production でキーがない → エラー
 *    （起動時に気づけるようにする。本番でコードをログに出さない）
 * 4. それ以外（ローカルの next dev）→ Console
 *
 * エラーのメッセージには環境変数の名前だけを書き、値は書かない
 */

type Env = Record<string, string | undefined>

export type EmailConfig = (
  | { mode: "test" }
  | { mode: "resend"; apiKey: string; from: string }
  | { mode: "console" }
) & {
  /** EMAIL_RECIPIENT_ALLOWLIST（正規化済み）。未設定なら制限しない */
  allowlist?: ReadonlySet<string>
  /** OTP_ALERT_EMAIL（正規化済み）。管理者へのアラートの宛先（A3） */
  alertEmail?: string
}

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmailConfigError"
  }
}

/** 空白だけの値は未設定とみなす */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined))

const normalizedEmail = z.string().transform((v, ctx) => {
  const email = normalizeEmail(v)
  if (email === null) {
    ctx.addIssue({ code: "custom", message: "invalid" })
    return z.NEVER
  }
  return email
})

// 「アドレス」か「表示名 <アドレス>」。表示名に改行・制御文字・<> を含めない
const FROM_PATTERN = /^(?:([^<>\u0000-\u001f\u007f]+?)\s*<([^<>\s]+)>|([^<>\s]+))$/

const emailFrom = z.string().refine((v) => {
  const match = FROM_PATTERN.exec(v)
  if (!match) return false
  const address = match[2] ?? match[3]
  return normalizeEmail(address) === address.toLowerCase()
})

const envSchema = z.object({
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString.pipe(emailFrom.optional()),
  EMAIL_RECIPIENT_ALLOWLIST: optionalString.pipe(
    z
      .string()
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(normalizedEmail))
      .optional()
  ),
  OTP_ALERT_EMAIL: optionalString.pipe(normalizedEmail.optional()),
})

/**
 * E2E_BUILD=true のビルドか。`process.env.E2E_BUILD` は next.config.ts の `env` でビルド時に埋め込まれるので、
 * 必ずこの字のとおりに読む（`env.E2E_BUILD` のように別名で読むと埋め込まれない）
 */
function isE2EBuild(): boolean {
  return process.env.E2E_BUILD === "true"
}

export interface ResolveEmailConfigOptions {
  /** E2E_BUILD=true のビルドか（テストで差し替える） */
  e2eBuild?: boolean
}

function isDeployed(env: Env): boolean {
  return Boolean(env.VERCEL_ENV && env.VERCEL_ENV !== "development") || env.NODE_ENV === "production"
}

export function resolveEmailConfig(
  env: Env,
  { e2eBuild = isE2EBuild() }: ResolveEmailConfigOptions = {}
): EmailConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))]
    throw new EmailConfigError(`メールの環境変数の値が正しくありません: ${names.join(", ")}`)
  }
  const { RESEND_API_KEY, EMAIL_FROM, EMAIL_RECIPIENT_ALLOWLIST, OTP_ALERT_EMAIL } = parsed.data
  const extras = {
    ...(EMAIL_RECIPIENT_ALLOWLIST?.length ? { allowlist: new Set(EMAIL_RECIPIENT_ALLOWLIST) } : {}),
    ...(OTP_ALERT_EMAIL ? { alertEmail: OTP_ALERT_EMAIL } : {}),
  }

  if (e2eBuild && isE2ERuntimeEnabled(env)) return { mode: "test", ...extras }

  if (RESEND_API_KEY) {
    if (!EMAIL_FROM) throw new EmailConfigError("RESEND_API_KEY を使うには EMAIL_FROM が必要です")
    // 本番は送信数の監視の知らせ（A3b）の宛先が要る。Preview は任意
    if (env.VERCEL_ENV === "production" && !OTP_ALERT_EMAIL) {
      throw new EmailConfigError("本番では OTP_ALERT_EMAIL が必要です")
    }
    return { mode: "resend", apiKey: RESEND_API_KEY, from: EMAIL_FROM, ...extras }
  }

  if (isDeployed(env)) {
    throw new EmailConfigError("本番・Vercel では RESEND_API_KEY と EMAIL_FROM が必要です")
  }
  return { mode: "console", ...extras }
}
