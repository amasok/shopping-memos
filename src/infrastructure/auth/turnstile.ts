import type { AuthEnv } from "./env"

/**
 * Cloudflare Turnstile の siteverify（#61 A3a 2.4。design の D4「Turnstile」）
 *
 * - 結果の success に加え、hostname がアプリのホスト（trustedOrigins のどれか）で、action が `send-otp` であることを確かめる
 * - Cloudflare のテスト用の secret（1x… は常に成功、2x…・3x… は常に失敗）は、ネットワークに出ずにその決まりどおりに返す
 *   （テスト用のキーは本物の hostname・action を返さないため。本番ではテスト用のキーを使えない（env.ts））
 * - 通信の失敗・タイムアウトは「確かめられない」として false（送らない）
 */

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
export const TURNSTILE_ACTION = "send-otp"
const TIMEOUT_MS = 5000
const TOKEN_MAX_LENGTH = 2048

interface SiteverifyResult {
  success?: boolean
  hostname?: string
  action?: string
}

export interface VerifyTurnstileInput {
  token: string | null
  remoteIp: string
  /** 対話型のチャレンジの段階か（A3b）。true ならチャレンジ用のウィジェットの secret でだけ確かめる */
  challenge: boolean
  env: Pick<AuthEnv, "turnstile" | "trustedOrigins">
  fetch?: typeof fetch
}

export async function verifyTurnstileToken({
  token,
  remoteIp,
  challenge,
  env,
  fetch: fetchImpl = fetch,
}: VerifyTurnstileInput): Promise<boolean> {
  if (!token || token.length > TOKEN_MAX_LENGTH) return false
  // チャレンジの段階では、非表示のウィジェットのトークンを受け付けない（その secret で確かめない）
  const secret = challenge ? env.turnstile.challengeSecretKey : env.turnstile.secretKey

  if (/^[123]x0000/.test(secret)) return secret.startsWith("1x")

  const form = new URLSearchParams({ secret, response: token })
  if (remoteIp !== "unknown") form.set("remoteip", remoteIp)

  let result: SiteverifyResult
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return false
    result = (await response.json()) as SiteverifyResult
  } catch {
    return false
  }

  const allowedHosts = new Set(env.trustedOrigins.map((origin) => new URL(origin).hostname))
  return (
    result.success === true &&
    typeof result.hostname === "string" &&
    allowedHosts.has(result.hostname) &&
    result.action === TURNSTILE_ACTION
  )
}
