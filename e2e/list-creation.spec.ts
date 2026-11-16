import { test, expect } from "@playwright/test"
import { setupCleanPage } from "./fixtures/test-helpers"
import { resetIdCounter } from "./fixtures/test-data"

test.describe("買い物リスト作成", () => {
  test.beforeEach(async ({ page }) => {
    resetIdCounter()
    await setupCleanPage(page, "/lists")
  })

  test("D-1: リスト一覧の空状態", async ({ page }) => {
    const emptyState = page.locator("[data-testid='lists-empty-state']")
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toContainText("進行中のリストがありません")
  })

  test("D-2: 既存アイテムからリスト作成 → 詳細へ遷移", async ({ page }) => {
    // まずアイテムを追加（ホームページから）
    await page.goto("/")
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-continue']").click()
    // フォームがリセットされる前に fill すると、リセットで消えてボタンが無効のままになる
    await expect(page.locator("[data-testid='item-name-input']")).toHaveValue("")
    await page.locator("[data-testid='item-name-input']").fill("パン")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // リスト作成ページへ遷移
    await page.goto("/lists/new")

    // アイテムが表示されるのを待つ
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })

    // アイテムを選択
    const itemList = page.locator("[data-testid='existing-items-list']")
    await itemList.locator("label").first().click()

    // リスト作成
    await page.locator("[data-testid='item-selector-submit']").click()

    // リスト詳細ページに遷移
    await expect(page).toHaveURL(/\/lists\//)
    await expect(page.locator("[data-testid='unchecked-section']")).toBeVisible({ timeout: 10000 })
  })

  test("D-3: リスト名設定付きリスト作成", async ({ page }) => {
    // アイテムを追加（ホームから）
    await page.goto("/")
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // リスト作成ページへ
    await page.goto("/lists/new")
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })

    // リスト名を設定
    await page.locator("[data-testid='list-name-input']").fill("スーパーで買い物")

    // アイテムを選択
    const itemList = page.locator("[data-testid='existing-items-list']")
    await itemList.locator("label").first().click()

    // リスト作成
    await page.locator("[data-testid='item-selector-submit']").click()

    // リスト詳細ページに遷移し、名前が表示される
    await expect(page).toHaveURL(/\/lists\//)
    await expect(page.locator("[data-testid='list-name']")).toContainText("スーパーで買い物")
  })

  test("D-7: リスト一覧に進捗が表示される", async ({ page }) => {
    // アイテムとリストを作成
    await page.goto("/")
    await page.locator("[data-testid='fab-add-item']").click()
    await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    await page.goto("/lists/new")
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })
    await page.locator("[data-testid='existing-items-list']").locator("label").first().click()
    await page.locator("[data-testid='item-selector-submit']").click()
    await expect(page).toHaveURL(/\/lists\//)

    // リスト一覧に戻る
    await page.locator("[data-testid='back-button']").click()
    await expect(page).toHaveURL(/\/lists$/)

    // リスト一覧に進捗が表示される
    const listItem = page.locator("[data-testid='lists-list'] li").first()
    await expect(listItem).toBeVisible()
    await expect(listItem).toContainText("完了")
  })
})
