import { test, expect } from "@playwright/test"
import { setupCleanPage } from "./fixtures/test-helpers"
import { resetIdCounter } from "./fixtures/test-data"

test.describe("購入履歴", () => {
  // ヘルパー: アイテム追加 → リスト作成 → 全チェック → 購入完了 で履歴を作る
  async function createHistory(page: import("@playwright/test").Page, items: string[]) {
    await page.goto("/")

    // アイテムを追加
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    for (let i = 0; i < items.length; i++) {
      await page.locator("[data-testid='item-name-input']").fill(items[i])
      if (i < items.length - 1) {
        await page.locator("[data-testid='item-add-continue']").click()
        await expect(page.locator("[data-testid='item-name-input']")).toHaveValue("")
      } else {
        await page.locator("[data-testid='item-add-close']").click()
      }
    }
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // リスト作成
    await page.goto("/lists/new")
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })
    await page.locator("[data-testid='select-all']").click()
    await page.locator("[data-testid='item-selector-submit']").click()
    await expect(page).toHaveURL(/\/lists\//)
    await page.locator("[data-testid='unchecked-section']").waitFor({ state: "visible", timeout: 10000 })

    // 全チェック
    const uncheckedList = page.locator("[data-testid='unchecked-list']")
    const labels = uncheckedList.locator("label")
    const count = await labels.count()
    for (let i = 0; i < count; i++) {
      await labels.first().click()
      await page.waitForTimeout(300)
    }

    // 購入完了
    await page.locator("[data-testid='complete-button']").click()
    await expect(page).toHaveURL(/\/history/, { timeout: 10000 })
  }

  test.beforeEach(async ({ page }) => {
    resetIdCounter()
    await setupCleanPage(page, "/history")
  })

  test("F-1: 空状態が表示される", async ({ page }) => {
    const emptyState = page.locator("[data-testid='history-empty-state']")
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toContainText("購入履歴がありません")
  })

  test("F-2: 購入履歴が表示される", async ({ page }) => {
    // 履歴を作成
    await createHistory(page, ["牛乳", "パン"])

    // 履歴リストが表示される
    const historyList = page.locator("[data-testid='history-list']")
    await expect(historyList).toBeVisible()

    // 最初の履歴にアイテム数が表示される
    const firstRecord = historyList.locator("li").first()
    await expect(firstRecord).toContainText("2点")
  })

  test("F-3: 履歴を展開してアイテム詳細を表示", async ({ page }) => {
    await createHistory(page, ["牛乳"])

    // 履歴をクリックして展開
    const firstRecord = page.locator("[data-testid='history-list'] li").first()
    await firstRecord.locator("button").first().click()

    // アイテム名が表示される
    await expect(firstRecord).toContainText("牛乳")
    // リストに戻すボタンが表示される
    await expect(firstRecord.locator("button", { hasText: "リストに戻す" })).toBeVisible()
  })

  test("F-4: リストに戻す → /lists に遷移", async ({ page }) => {
    await createHistory(page, ["牛乳"])

    // 展開
    const firstRecord = page.locator("[data-testid='history-list'] li").first()
    await firstRecord.locator("button").first().click()

    // リストに戻す
    await firstRecord.locator("button", { hasText: "リストに戻す" }).click()

    // /lists に遷移
    await expect(page).toHaveURL(/\/lists/, { timeout: 10000 })
  })

  test("F-5: 履歴を削除", async ({ page }) => {
    await createHistory(page, ["牛乳"])

    // 展開
    const firstRecord = page.locator("[data-testid='history-list'] li").first()
    await firstRecord.locator("button").first().click()

    // 削除ボタンをクリック
    await firstRecord.locator("[data-testid^='history-delete-']").click()

    // 確認ダイアログで削除
    await page.locator("[data-testid='history-delete-confirm']").click()

    // 空状態に戻る
    await expect(page.locator("[data-testid='history-empty-state']")).toBeVisible({ timeout: 10000 })
  })
})
