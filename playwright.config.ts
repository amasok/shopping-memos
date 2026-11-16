import { randomBytes } from "crypto"
import { defineConfig, devices } from "@playwright/test"

// E2E 専用ルート（seed API・テスト用ログイン）の共有シークレット（#70）。
// 未設定ならここで生成する。webServer とテストの worker は環境変数を引き継ぐので同じ値になる。
// 自分で起動したサーバーを再利用する場合は、サーバーとテストの両方に同じ E2E_SEED_TOKEN を設定する
process.env.E2E_SEED_TOKEN ||= randomBytes(32).toString("hex")

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
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
            baseURL: "http://localhost:3100",
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
            command: "AUTH_TRUST_HOST=true E2E_TEST=true npx next start -p 3100",
            url: "http://localhost:3100",
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
          },
        ]
      : []),
    {
    // CI は事前に E2E_BUILD=true npm run build 済みの本番ビルドで起動する（dev の初回コンパイル待ちによるタイムアウトを避ける）
    // E2E 専用ルートは E2E_BUILD=true のビルド（dev ではサーバー起動時）にだけ含まれる（#70）
    command: process.env.CI
      ? "E2E_TEST=true npm run start"
      : "E2E_BUILD=true E2E_TEST=true npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    },
  ],
})
