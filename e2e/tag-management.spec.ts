import { test, expect } from "@playwright/test"
import { setupCleanPage, waitForBottomSheet } from "./fixtures/test-helpers"
import { resetIdCounter } from "./fixtures/test-data"

test.describe("タグ管理", () => {
  test.beforeEach(async ({ page }) => {
    resetIdCounter()
    await setupCleanPage(page, "/tags")
  })

  test("C-1: タグ一覧が表示される（デフォルトタグ）", async ({ page }) => {
    // デフォルトタグが表示される（DBクリア後に自動シード）
    const tagList = page.locator("[data-testid='tag-list']")
    await expect(tagList).toBeVisible()
    await expect(tagList).toContainText("食品")
    await expect(tagList).toContainText("日用品")
    await expect(tagList).toContainText("エンタメ")
  })

  test("C-2: タグを追加できる", async ({ page }) => {
    // 追加ボタンをクリック
    await page.locator("[data-testid='tag-add-button']").click()

    // タグ名を入力
    await page.locator("[data-testid='tag-name-input']").fill("野菜")

    // 追加ボタンをクリック
    await page.locator("[data-testid='tag-add-submit']").click()

    // タグ一覧に表示される
    const tagList = page.locator("[data-testid='tag-list']")
    await expect(tagList).toBeVisible()
    await expect(tagList).toContainText("野菜")
    await expect(tagList).toContainText("(0件)")
  })

  test("C-3: タグを編集できる", async ({ page }) => {
    // デフォルトタグの最初の要素（食品）を編集
    const tagList = page.locator("[data-testid='tag-list']")
    await expect(tagList).toBeVisible()

    // 編集ボタンをクリック（「食品」タグ）
    const tagItem = tagList.locator("li").filter({ hasText: "食品" })
    await tagItem.locator("button[aria-label*='編集']").click()
    await waitForBottomSheet(page)

    // 名前を変更
    await page.locator("[data-testid='tag-edit-name-input']").clear()
    await page.locator("[data-testid='tag-edit-name-input']").fill("フルーツ")
    await page.locator("[data-testid='tag-edit-submit']").click()

    // BottomSheetが閉じる
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // 名前が変更されている（タグリスト全体で確認）
    await expect(tagList).toContainText("フルーツ")
    await expect(tagList).not.toContainText("食品", { timeout: 10000 })
  })

  test("C-4: タグを削除できる", async ({ page }) => {
    // タグを追加
    await page.locator("[data-testid='tag-add-button']").click()
    await page.locator("[data-testid='tag-name-input']").fill("野菜")
    await page.locator("[data-testid='tag-add-submit']").click()
    await expect(page.locator("[data-testid='tag-list']")).toContainText("野菜")

    // 追加したタグ（「野菜」）の削除ボタンをクリック
    const tagItem = page.locator("[data-testid='tag-list'] li").filter({ hasText: "野菜" })
    await tagItem.locator("button[aria-label*='削除']").click()

    // 確認ボタンをクリック
    await page.locator("[data-testid='tag-delete-confirm']").click()

    // タグが削除されている（デフォルトタグは残る）
    await expect(page.locator("[data-testid='tag-list']")).not.toContainText("野菜", { timeout: 10000 })
    await expect(page.locator("[data-testid='tag-list']")).toContainText("食品")
  })

  test("C-6: デフォルトタグ表示", async ({ page }) => {
    const tagList = page.locator("[data-testid='tag-list']")
    await expect(tagList).toBeVisible()
    // デフォルトタグ3つが表示される
    const items = tagList.locator("li")
    await expect(items).toHaveCount(3)
    await expect(tagList).toContainText("食品")
    await expect(tagList).toContainText("日用品")
    await expect(tagList).toContainText("エンタメ")
  })
})
