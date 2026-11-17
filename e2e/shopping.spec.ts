import { test, expect } from "@playwright/test"
import { seedTable, setupCleanPage } from "./fixtures/test-helpers"
import { createItem, resetIdCounter } from "./fixtures/test-data"

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

  /** ゲスト DB のカタログの商品（名前と購入日時） */
  async function catalogItems(page: import("@playwright/test").Page) {
    return page.evaluate(
      () =>
        new Promise<Array<{ name: string; purchasedAt?: string }>>((resolve, reject) => {
          const request = indexedDB.open("ShoppingMemosDB")
          request.onsuccess = () => {
            const db = request.result
            const all = db.transaction("items", "readonly").objectStore("items").getAll()
            all.onsuccess = () => {
              db.close()
              resolve(all.result.map((i: { name: string; purchasedAt?: string }) => ({ name: i.name, purchasedAt: i.purchasedAt })))
            }
            all.onerror = () => reject(all.error)
          }
          request.onerror = () => reject(request.error)
        })
    )
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

  test.describe("チェック 0 件の完了（179b）", () => {
    async function openNoCheckedDialog(page: import("@playwright/test").Page) {
      await page.locator("[data-testid='partial-complete-button']").click()
      await page.locator("[data-testid='no-checked-dialog']").waitFor({ state: "visible" })
    }

    test("E-9: チェック 0 件で完了を押すと確認ダイアログを出す", async ({ page }) => {
      await createListWithItems(page, ["牛乳", "パン"])

      const button = page.locator("[data-testid='partial-complete-button']")
      await expect(button).toHaveText("買い物を完了")
      await expect(button).toBeEnabled()
      await openNoCheckedDialog(page)

      await expect(page.locator("[data-testid='bottom-sheet-title']")).toHaveText("カゴに入れたものがありません")
      await expect(page.locator("[data-testid='no-checked-delete-with-items']")).toHaveText("リストの商品ごと消す")
      await expect(page.locator("[data-testid='no-checked-delete-list-only']")).toHaveText("リストだけ消して商品は元に戻す")
      await expect(page.locator("[data-testid='no-checked-cancel']")).toHaveText("キャンセル")
    })

    test("E-10: リストの商品ごと消すとリストと同じ名前の未購入の商品を削除する", async ({ page }) => {
      await createListWithItems(page, ["牛乳", "パン"])
      // 前に買った同じ名前の商品（購入済み）は残る
      const purchasedAt = new Date("2026-11-01T00:00:00.000Z").toISOString()
      await seedTable(page, "items", [createItem({ name: "牛乳", purchasedAt })])

      await openNoCheckedDialog(page)
      await page.locator("[data-testid='no-checked-delete-with-items']").click()

      await expect(page).toHaveURL(/\/lists$/, { timeout: 10000 })
      await expect(page.locator("[data-testid='lists-empty-state']")).toBeVisible()
      await expect.poll(() => catalogItems(page)).toEqual([{ name: "牛乳", purchasedAt }])
      // 購入履歴は作られない
      await page.goto("/history")
      await expect(page.locator("[data-testid='history-empty-state']")).toBeVisible()
    })

    test("E-11: リストだけ消すとカタログの商品は変えずに買いたいものに戻る", async ({ page }) => {
      await createListWithItems(page, ["牛乳", "パン"])

      await openNoCheckedDialog(page)
      await page.locator("[data-testid='no-checked-delete-list-only']").click()

      await expect(page).toHaveURL(/\/lists$/, { timeout: 10000 })
      await expect(page.locator("[data-testid='lists-empty-state']")).toBeVisible()
      await page.goto("/")
      const itemList = page.locator("[data-testid='item-list']")
      await expect(itemList).toContainText("牛乳")
      await expect(itemList).toContainText("パン")
      expect((await catalogItems(page)).every((i) => !i.purchasedAt)).toBe(true)
      await page.goto("/history")
      await expect(page.locator("[data-testid='history-empty-state']")).toBeVisible()
    })

    test("E-12: キャンセルするとリストはそのまま", async ({ page }) => {
      await createListWithItems(page, ["牛乳"])

      await openNoCheckedDialog(page)
      await page.locator("[data-testid='no-checked-cancel']").click()

      await expect(page.locator("[data-testid='no-checked-dialog']")).toBeHidden()
      await expect(page).toHaveURL(/\/lists\/detail/)
      await expect(page.locator("[data-testid='unchecked-section']")).toContainText("牛乳")
      expect(await catalogItems(page)).toEqual([{ name: "牛乳", purchasedAt: undefined }])
    })
  })

  test.describe("メニューからのリストの削除（#191）", () => {
    async function openDeleteDialog(page: import("@playwright/test").Page) {
      await page.locator("[data-testid='list-menu-button']").click()
      await page.locator("[data-testid='list-delete-menu']").click()
      await page.locator("[data-testid='list-delete-dialog']").waitFor({ state: "visible" })
    }

    test("E-13: メニューで商品ごと消すとリストと同じ名前の未購入の商品も削除する", async ({ page }) => {
      await createListWithItems(page, ["牛乳", "パン"])
      // 前に買った同じ名前の商品（購入済み）は残る
      const purchasedAt = new Date("2026-11-01T00:00:00.000Z").toISOString()
      await seedTable(page, "items", [createItem({ name: "牛乳", purchasedAt })])

      await openDeleteDialog(page)
      await expect(page.locator("[data-testid='list-delete-option-list-only']")).toBeChecked()
      await page.locator("[data-testid='list-delete-option-with-items']").check()
      await page.locator("[data-testid='list-delete-confirm']").click()

      await expect(page).toHaveURL(/\/lists$/, { timeout: 10000 })
      await expect(page.locator("[data-testid='lists-empty-state']")).toBeVisible()
      await expect.poll(() => catalogItems(page)).toEqual([{ name: "牛乳", purchasedAt }])
    })

    test("E-14: メニューでリストだけ消すとカタログの商品は変えずに買いたいものに戻る", async ({ page }) => {
      await createListWithItems(page, ["牛乳", "パン"])

      await openDeleteDialog(page)
      await page.locator("[data-testid='list-delete-confirm']").click()

      await expect(page).toHaveURL(/\/lists$/, { timeout: 10000 })
      await expect(page.locator("[data-testid='lists-empty-state']")).toBeVisible()
      await page.goto("/")
      const itemList = page.locator("[data-testid='item-list']")
      await expect(itemList).toContainText("牛乳")
      await expect(itemList).toContainText("パン")
      expect((await catalogItems(page)).every((i) => !i.purchasedAt)).toBe(true)
    })
  })
})
