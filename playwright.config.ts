import { randomBytes } from "crypto"
import { defineConfig, devices } from "@playwright/test"
import { E2E_OFFLINE_ORIGIN, E2E_OFFLINE_PORT, E2E_ORIGIN, E2E_PORT } from "./e2e/ports"

// E2E 専用ルート（seed API・テスト用ログイン）の共有シークレット（#70）。
// 未設定ならここで生成する。webServer とテストの worker は環境変数を引き継ぐので同じ値になる。
// 自分で起動したサーバーを再利用する場合は、サーバーとテストの両方に同じ E2E_SEED_TOKEN を設定する
process.env.E2E_SEED_TOKEN ||= randomBytes(32).toString("hex")

// 本番ビルド（next start）で起動するか。CI と scripts/e2e-local.sh（E2E_START=true）は、事前に
// E2E_BUILD=true npm run build したものを使う。それ以外（手元で npx playwright test）は dev サーバー
const useBuild = !!process.env.CI || process.env.E2E_START === "true"
// 既に動いているサーバーを使い回すか。scripts/e2e-local.sh は、別の worktree のサーバーに当たらないよう使い回さない
const reuseExistingServer = !process.env.CI && process.env.E2E_REUSE_SERVER !== "false"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: E2E_ORIGIN,
    // 既存テストは SW の影響を受けない（SW は offline プロジェクトだけで有効にする）
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // 認証セットアップ（storageState保存）
    {
      name: "auth-setup",
      testMatch: /auth\/auth\.setup\.ts/,
    },
    // 既存ゲストモードテスト（変更なし）
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/auth\//, /offline\//],
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
      testIgnore: [/auth\//, /offline\//],
    },
    // ログイン済みテスト
    {
      name: "chromium-auth",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user-a.json",
      },
      dependencies: ["auth-setup"],
      testDir: "./e2e/auth",
      testIgnore: /auth\.setup\.ts/,
    },
    // SW・オフライン（本番ビルドが必要。E2E_OFFLINE=true のときだけ有効: E2E_BUILD=true npm run build 後に実行）
    ...(process.env.E2E_OFFLINE
      ? [
        {
          name: "offline",
          use: {
            ...devices["Desktop Chrome"],
            baseURL: E2E_OFFLINE_ORIGIN,
            serviceWorkers: "allow" as const,
          },
          testDir: "./e2e/offline",
        },
        ]
      : []),
  ],
  webServer: [
    ...(process.env.E2E_OFFLINE
      ? [
          {
            command: `AUTH_TRUST_HOST=true E2E_TEST=true npx next start -p ${E2E_OFFLINE_PORT}`,
            url: E2E_OFFLINE_ORIGIN,
            reuseExistingServer,
            timeout: 120 * 1000,
          },
        ]
      : []),
    {
    // CI は事前に E2E_BUILD=true npm run build 済みの本番ビルドで起動する（dev の初回コンパイル待ちによるタイムアウトを避ける）
    // E2E 専用ルートは E2E_BUILD=true のビルド（dev ではサーバー起動時）にだけ含まれる（#70）
    command: useBuild
      ? `E2E_TEST=true npm run start -- -p ${E2E_PORT}`
      : `E2E_BUILD=true E2E_TEST=true npm run dev -- -p ${E2E_PORT}`,
    url: E2E_ORIGIN,
    reuseExistingServer,
    timeout: 120 * 1000,
    },
  ],
})
