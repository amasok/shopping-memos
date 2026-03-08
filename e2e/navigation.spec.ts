import { test, expect } from "@playwright/test"
import { setupCleanPage } from "./fixtures/test-helpers"

test.describe("ナビゲーション", () => {
  test.beforeEach(async ({ page }) => {
    await setupCleanPage(page, "/")
  })

  test("H-1: BottomNavで4ページに遷移できる", async ({ page }) => {
    // ホームページが表示されている
    await expect(page).toHaveTitle(/買い物メモ/)
    const nav = page.locator("[data-testid='bottom-nav']")
    await expect(nav).toBeVisible()

    // リストタブに遷移
    await page.locator("[data-testid='nav-lists']").click()
    await expect(page).toHaveURL(/\/lists/)
    await expect(page.locator("h1")).toContainText("買い物リスト")

    // 履歴タブに遷移
    await page.locator("[data-testid='nav-history']").click()
    await expect(page).toHaveURL(/\/history/)
    await expect(page.locator("h1")).toContainText("購入履歴")

    // 設定タブに遷移
    await page.locator("[data-testid='nav-settings']").click()
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.locator("h1")).toContainText("設定")

    // ホームに戻る（Mobile Chromeでdev overlay badgeと重なるため先に非表示化）
    await page.evaluate(() => {
      document.querySelectorAll("nextjs-portal").forEach((el) => el.remove())
    })
    await page.locator("[data-testid='nav-home']").click()
    await expect(page).toHaveURL("/")
    await expect(page.locator("h1")).toContainText("買いたいもの")
  })
})
