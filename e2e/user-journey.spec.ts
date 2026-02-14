import { test, expect } from "@playwright/test"
import { setupCleanPage } from "./fixtures/test-helpers"
import { resetIdCounter } from "./fixtures/test-data"

test.describe("複合シナリオ", () => {
  test.beforeEach(async ({ page }) => {
    resetIdCounter()
    await setupCleanPage(page, "/")
  })

  test("K-1: アイテム追加 → リスト作成 → 買い物完了 → 履歴確認", async ({ page }) => {
    // 1. アイテム追加
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-continue']").click()
    await page.locator("[data-testid='item-name-input']").fill("パン")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // アイテムが表示される
    await expect(page.locator("[data-testid='item-list']")).toContainText("牛乳")
    await expect(page.locator("[data-testid='item-list']")).toContainText("パン")

    // 2. リスト作成
    await page.goto("/lists/new")
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })
    await page.locator("[data-testid='select-all']").click()
    await page.locator("[data-testid='item-selector-submit']").click()
    await expect(page).toHaveURL(/\/lists\//)
    await page.locator("[data-testid='unchecked-section']").waitFor({ state: "visible", timeout: 10000 })

    // 3. 全アイテムをチェック
    const uncheckedList = page.locator("[data-testid='unchecked-list']")
    const labels = uncheckedList.locator("label")
    const count = await labels.count()
    for (let i = 0; i < count; i++) {
      await labels.first().click()
      await page.waitForTimeout(300)
    }

    // 4. 購入完了
    await expect(page.locator("[data-testid='all-checked-message']")).toBeVisible()
    await page.locator("[data-testid='complete-button']").click()

    // 5. 履歴ページに遷移
    await expect(page).toHaveURL(/\/history/, { timeout: 10000 })

    // 6. 履歴が表示される
    const historyList = page.locator("[data-testid='history-list']")
    await expect(historyList).toBeVisible()
    await expect(historyList.locator("li").first()).toContainText("2点")
  })

  test("K-2: タグ作成 → アイテムにタグ付け → タグフィルタで確認", async ({ page }) => {
    // 1. タグページでタグ作成
    await page.goto("/tags")
    await page.locator("[data-testid='tag-add-button']").click()
    await page.locator("[data-testid='tag-name-input']").fill("乳製品")
    await page.locator("[data-testid='tag-add-submit']").click()
    await expect(page.locator("[data-testid='tag-list']")).toContainText("乳製品")

    // 2. ホームに戻ってアイテムを追加（タグ付き）
    await page.goto("/")
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("牛乳")

    // タグを選択（タグ名でボタンを探す）
    await page.locator("[data-testid='item-form']").locator("button", { hasText: "乳製品" }).click()

    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // タグなしのアイテムを別途追加
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("パン")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // 3. タグフィルタで絞り込み
    const tagFilter = page.locator("[data-testid='tag-filter']")
    await tagFilter.locator("button", { hasText: "乳製品" }).click()

    // 牛乳だけ表示
    await expect(page.locator("[data-testid='item-list']")).toContainText("牛乳")
    await expect(page.locator("[data-testid='item-list']")).not.toContainText("パン")

    // すべてに戻す
    await page.locator("[data-testid='tag-filter-all']").click()
    await expect(page.locator("[data-testid='item-list']")).toContainText("牛乳")
    await expect(page.locator("[data-testid='item-list']")).toContainText("パン")
  })

  test("K-3: リスト作成 → チェック → リスト削除", async ({ page }) => {
    // アイテム追加
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // リスト作成
    await page.goto("/lists/new")
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })
    await page.locator("[data-testid='existing-items-list']").locator("label").first().click()
    await page.locator("[data-testid='item-selector-submit']").click()
    await expect(page).toHaveURL(/\/lists\//)
    await page.locator("[data-testid='unchecked-section']").waitFor({ state: "visible", timeout: 10000 })

    // 一部チェック
    await page.locator("[data-testid='unchecked-list']").locator("label").first().click()

    // リスト削除
    await page.locator("[data-testid='list-menu-button']").click()
    await page.locator("[data-testid='list-delete-menu']").click()
    await page.locator("[data-testid='list-delete-confirm']").click()

    // /lists に遷移
    await expect(page).toHaveURL(/\/lists$/, { timeout: 10000 })
  })

  test("K-4: 購入完了 → 履歴からリストに戻す → 再度買い物", async ({ page }) => {
    // アイテム追加
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // リスト作成
    await page.goto("/lists/new")
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })
    await page.locator("[data-testid='select-all']").click()
    await page.locator("[data-testid='item-selector-submit']").click()
    await expect(page).toHaveURL(/\/lists\//)
    await page.locator("[data-testid='unchecked-section']").waitFor({ state: "visible", timeout: 10000 })

    // 全チェック＆購入完了
    await page.locator("[data-testid='unchecked-list']").locator("label").first().click()
    await expect(page.locator("[data-testid='all-checked-message']")).toBeVisible()
    await page.locator("[data-testid='complete-button']").click()
    await expect(page).toHaveURL(/\/history/, { timeout: 10000 })

    // 履歴からリストに戻す
    const firstRecord = page.locator("[data-testid='history-list'] li").first()
    await firstRecord.locator("button").first().click() // 展開
    await firstRecord.locator("button", { hasText: "リストに戻す" }).click()

    // /lists に遷移
    await expect(page).toHaveURL(/\/lists/, { timeout: 10000 })

    // リストが復活している
    await expect(page.locator("[data-testid='lists-list']")).toBeVisible()
  })
})
