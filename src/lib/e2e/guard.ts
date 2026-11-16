import { createHash, timingSafeEqual } from "crypto"

/**
 * E2E 専用の機能（/api/e2e/seed、E2E 用の Credentials ログイン）の有効化条件（#70）
 *
 * - ビルド時: `E2E_BUILD=true` のビルドにだけ含める（`next.config.ts` の pageExtensions と env）
 * - 実行時: 次をすべて満たすときだけ有効
 *   1. `E2E_TEST === "true"`
 *   2. Vercel の環境ではない（`VERCEL_ENV` が未設定か `development`）
 *   3. `E2E_SEED_TOKEN` が十分な長さで設定され、リクエストの `x-e2e-token` と一致する
 *
 * `NODE_ENV` には頼らない。オフライン E2E（#62）は本番ビルド（next start）で動かすため。
 */

export const E2E_EMAIL_DOMAIN = "@e2e-test.local"
export const E2E_TOKEN_HEADER = "x-e2e-token"
/** 推測されにくい値だけを受け付ける（Playwright は 32 バイトの hex を生成する） */
export const E2E_TOKEN_MIN_LENGTH = 32

type Env = Record<string, string | undefined>

/** 実行時の環境変数の条件（トークンの照合以外）を満たすか */
export function isE2ERuntimeEnabled(env: Env = process.env): boolean {
  if (env.E2E_TEST !== "true") return false
  // production / preview に加え、未知の値も Vercel 上とみなして無効にする
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "development") return false
  return (env.E2E_SEED_TOKEN ?? "").length >= E2E_TOKEN_MIN_LENGTH
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

/** リクエストヘッダのトークンが E2E_SEED_TOKEN と一致するか（定数時間で比較） */
export function hasValidE2EToken(headers: Headers, env: Env = process.env): boolean {
  const expected = env.E2E_SEED_TOKEN ?? ""
  const actual = headers.get(E2E_TOKEN_HEADER) ?? ""
  if (expected.length < E2E_TOKEN_MIN_LENGTH || actual.length === 0) return false
  return timingSafeEqual(digest(actual), digest(expected))
}

/** E2E 専用の機能をこのリクエストに許可するか */
export function isE2ERequestAllowed(
  request: Pick<Request, "headers">,
  env: Env = process.env
): boolean {
  return isE2ERuntimeEnabled(env) && hasValidE2EToken(request.headers, env)
}

/** E2E 用のテストアカウントのメールアドレスか */
export function isE2EEmail(email: unknown): email is string {
  return (
    typeof email === "string" &&
    email.length > E2E_EMAIL_DOMAIN.length &&
    email.toLowerCase().endsWith(E2E_EMAIL_DOMAIN)
  )
}

/**
 * pageExtensions（#70）。`E2E_BUILD=true` のときだけ `route.e2e.ts` をルートとして含める
 */
export function getPageExtensions(env: Env = process.env): string[] {
  const base = ["tsx", "ts", "jsx", "js"]
  return env.E2E_BUILD === "true" ? [...base, "e2e.ts"] : base
}
