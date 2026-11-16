/**
 * E2E で使うポート（#142）。worktree を並行して使うときに、ほかの worktree のサーバーに当たらないよう、
 * 環境変数で変えられるようにする。既定は従来どおり 3000（通常）と 3100（offline・本番ビルド）。
 * scripts/e2e-local.sh は空いているポートを選んで渡す
 */
function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} は 1024〜65535 の整数で指定してください（${raw}）`)
  }
  return port
}

export const E2E_PORT = portFromEnv("E2E_PORT", 3000)
export const E2E_OFFLINE_PORT = portFromEnv("E2E_OFFLINE_PORT", 3100)
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`
export const E2E_OFFLINE_ORIGIN = `http://localhost:${E2E_OFFLINE_PORT}`
