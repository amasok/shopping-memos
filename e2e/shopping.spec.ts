import { test, expect } from "@playwright/test"
import { setupCleanPage } from "./fixtures/test-helpers"
import { resetIdCounter } from "./fixtures/test-data"

test.describe("買い物中", () => {
  // ヘルパー: アイテムを追加してリストを作成し、リスト詳細ページにいる状態にする
  async function createListWithItems(page: import("@playwright/test").Page, items: string[]) {
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

    // リスト作成ページへ
    await page.goto("/lists/new")
    await page.locator("[data-testid='existing-items-list']").waitFor({ state: "visible", timeout: 10000 })

    // 全選択
    await page.locator("[data-testid='select-all']").click()

    // リスト作成
    await page.locator("[data-testid='item-selector-submit']").click()
    await expect(page).toHaveURL(/\/lists\//)
    await page.locator("[data-testid='unchecked-section']").waitFor({ state: "visible", timeout: 10000 })
  }

  test.beforeEach(async ({ page }) => {
    resetIdCounter()
    await setupCleanPage(page, "/")
  })

  test("E-1: リスト詳細が表示される", async ({ page }) => {
    await createListWithItems(page, ["牛乳", "パン"])

    // プログレスバーが表示される
    await expect(page.locator("[data-testid='progress-bar']")).toBeVisible()

    // 未チェックセクションにアイテムが表示される
    const uncheckedSection = page.locator("[data-testid='unchecked-section']")
    await expect(uncheckedSection).toContainText("牛乳")
    await expect(uncheckedSection).toContainText("パン")
  })

  test("E-2: アイテムをチェックするとカゴに入れたセクションに移動する", async ({ page }) => {
    await createListWithItems(page, ["牛乳", "パン"])

    // 牛乳のチェックボックスをクリック
    const uncheckedList = page.locator("[data-testid='unchecked-list']")
    await uncheckedList.locator("label").filter({ hasText: "牛乳" }).click()

    // カゴに入れたセクションが表示される
    await expect(page.locator("[data-testid='checked-section']")).toBeVisible()
    await expect(page.locator("[data-testid='checked-list']")).toContainText("牛乳")

    // 未チェックにはパンだけ残る
    await expect(page.locator("[data-testid='unchecked-list']")).toContainText("パン")
    await expect(page.locator("[data-testid='unchecked-list']")).not.toContainText("牛乳")
  })

  test("E-3: チェック解除で買うものセクションに戻る", async ({ page }) => {
    await createListWithItems(page, ["牛乳"])

    // チェック
    await page.locator("[data-testid='unchecked-list']").locator("label").filter({ hasText: "牛乳" }).click()
    await expect(page.locator("[data-testid='checked-list']")).toContainText("牛乳")

    // チェック解除
    await page.locator("[data-testid='checked-list']").locator("label").filter({ hasText: "牛乳" }).click()
    await expect(page.locator("[data-testid='unchecked-list']")).toContainText("牛乳")
  })

  test("E-4: 全チェック後の完了表示", async ({ page }) => {
    await createListWithItems(page, ["牛乳", "パン"])

    // 全アイテムをチェック
    const uncheckedList = page.locator("[data-testid='unchecked-list']")
    const labels = uncheckedList.locator("label")
    const count = await labels.count()
    for (let i = 0; i < count; i++) {
      await labels.first().click()
      // チェック後にDOMが更新されるので少し待つ
      await page.waitForTimeout(300)
    }

    // 「すべてカゴに入れました！」メッセージ
    await expect(page.locator("[data-testid='all-checked-message']")).toBeVisible()
    await expect(page.locator("[data-testid='all-checked-message']")).toContainText("すべてカゴに入れました")
  })

  test("E-5: 購入完了 → /history に遷移", async ({ page }) => {
    await createListWithItems(page, ["牛乳"])

    // 全チェック
    await page.locator("[data-testid='unchecked-list']").locator("label").first().click()
    await expect(page.locator("[data-testid='all-checked-message']")).toBeVisible()

    // 購入完了
    await page.locator("[data-testid='complete-button']").click()

    // /history に遷移
    await expect(page).toHaveURL(/\/history/, { timeout: 10000 })
  })

  test("E-6: 部分購入完了", async ({ page }) => {
    await createListWithItems(page, ["牛乳", "パン"])

    // 1つだけチェック
    const uncheckedList = page.locator("[data-testid='unchecked-list']")
    await uncheckedList.locator("label").filter({ hasText: "牛乳" }).click()
    await expect(page.locator("[data-testid='checked-list']")).toContainText("牛乳")

    // 部分購入完了ボタン
    await page.locator("[data-testid='partial-complete-button']").click()

    // /history に遷移
    await expect(page).toHaveURL(/\/history/, { timeout: 10000 })
  })

  test("E-7: リスト名編集", async ({ page }) => {
    await createListWithItems(page, ["牛乳"])

    // リスト名をクリックして編集モードに
    await page.locator("[data-testid='list-name']").click()

    // 入力フィールドが表示される
    await page.locator("[data-testid='list-name-input']").clear()
    await page.locator("[data-testid='list-name-input']").fill("スーパー")
    await page.locator("[data-testid='list-name-save']").click()

    // 名前が変更されている
    await expect(page.locator("[data-testid='list-name']")).toContainText("スーパー")
  })

  test("E-8: リスト削除", async ({ page }) => {
    await createListWithItems(page, ["牛乳"])

    // メニューを開く
    await page.locator("[data-testid='list-menu-button']").click()

    // リスト削除を選択
    await page.locator("[data-testid='list-delete-menu']").click()

    // 確認ダイアログで削除
    await page.locator("[data-testid='list-delete-confirm']").click()

    // /lists に遷移
    await expect(page).toHaveURL(/\/lists$/, { timeout: 10000 })
  })
})
