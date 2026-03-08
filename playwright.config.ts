import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
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
      testIgnore: /auth\//,
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
      testIgnore: /auth\//,
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
  ],
  webServer: {
    command: "E2E_TEST=true npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
