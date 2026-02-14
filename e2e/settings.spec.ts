import { test, expect } from "@playwright/test"
import { setupCleanPage } from "./fixtures/test-helpers"

test.describe("設定", () => {
  test.beforeEach(async ({ page }) => {
    await setupCleanPage(page, "/settings")
  })

  test("G-1: 設定画面が表示される（未ログイン状態）", async ({ page }) => {
    // 設定ページが表示される
    await expect(page.locator("h1")).toContainText("設定")

    // 未ログイン時のログイン促進が表示される
    await expect(page.locator("[data-testid='settings-page']")).toContainText("ログインして同期")
    await expect(page.locator("[data-testid='login-button']")).toBeVisible()

    // テーマセクション
    await expect(page.locator("[data-testid='settings-page']")).toContainText("テーマ")

    // 設定項目
    await expect(page.locator("[data-testid='settings-page']")).toContainText("タグ管理")
    await expect(page.locator("[data-testid='settings-page']")).toContainText("グループ管理")
  })

  test("G-2: テーマを切り替えられる", async ({ page }) => {
    // テーマボタンをクリック（2番目のテーマを選択）
    const themeButtons = page.locator("[data-testid='settings-page']").locator("button").filter({ has: page.locator("div.rounded-full.shadow-inner") })
    const secondTheme = themeButtons.nth(1)
    await secondTheme.click()

    // チェックマークが表示される（選択されたテーマにCheckアイコンが表示）
    await expect(secondTheme.locator("svg")).toBeVisible()
  })

  test("G-3: タグ管理へ遷移", async ({ page }) => {
    await page.locator("[data-testid='settings-tags-link']").click()
    await expect(page).toHaveURL(/\/tags/)
    await expect(page.locator("h1")).toContainText("タグ管理")
  })

  test("G-4: グループ管理へ遷移", async ({ page }) => {
    await page.locator("[data-testid='settings-groups-link']").click()
    await expect(page).toHaveURL(/\/groups/)
  })

  test("G-5: プライバシーポリシーへ遷移", async ({ page }) => {
    await page.locator("[data-testid='settings-privacy-link']").click()
    await expect(page).toHaveURL(/\/privacy/)
  })

  test("G-6: 利用規約へ遷移", async ({ page }) => {
    await page.locator("[data-testid='settings-terms-link']").click()
    await expect(page).toHaveURL(/\/terms/)
  })
})
