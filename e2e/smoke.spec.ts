import { test, expect } from "@playwright/test"

test.describe("スモークテスト", () => {
  test("ホームページが表示される", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveTitle(/買い物メモ/)
  })

  test("買い物リスト一覧ページが表示される", async ({ page }) => {
    await page.goto("/lists")
    await expect(page.locator("h1")).toBeVisible()
  })

  test("タグ一覧ページが表示される", async ({ page }) => {
    await page.goto("/tags")
    await expect(page.locator("h1")).toBeVisible()
  })

  test("履歴ページが表示される", async ({ page }) => {
    await page.goto("/history")
    await expect(page.locator("h1")).toBeVisible()
  })
})
