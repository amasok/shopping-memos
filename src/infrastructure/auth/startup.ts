import { resolveEmailConfig } from "./email/env"
import { resolveAuthEnv } from "./env"

/**
 * サーバーの起動時に、認証とメールの環境変数を確かめる（#61 A3a 0.3）
 *
 * src/instrumentation.ts の register から呼ぶ。本番・Vercel で欠けていれば例外を投げ、起動を止める
 * （最初のログインまで気づかない、を避ける）。`next build` では呼ばれない
 */
export function assertAuthEnvAtStartup(env: Record<string, string | undefined> = process.env): void {
  resolveAuthEnv(env)
  resolveEmailConfig(env)
}
