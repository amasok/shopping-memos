/**
 * サーバーの起動時の処理（Next.js の instrumentation）
 *
 * 認証とメールの環境変数を確かめる（#61 A3a 0.3）。Node.js のランタイムだけで行う
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { assertAuthEnvAtStartup } = await import("@/infrastructure/auth/startup")
  assertAuthEnvAtStartup()
}
