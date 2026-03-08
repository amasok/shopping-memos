import { test, expect } from "@playwright/test"
import { setupCleanPage, waitForBottomSheet } from "./fixtures/test-helpers"
import { resetIdCounter } from "./fixtures/test-data"

test.describe("アイテム管理", () => {
  test.beforeEach(async ({ page }) => {
    resetIdCounter()
    await setupCleanPage(page, "/")
  })

  test("A-1: 空状態が表示される", async ({ page }) => {
    const emptyState = page.locator("[data-testid='home-empty-state']")
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toContainText("買いたいものがありません")
  })

  test("A-2: FABからアイテムを追加できる", async ({ page }) => {
    // FABをクリック
    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)

    // BottomSheetのタイトルを確認
    await expect(page.locator("[data-testid='bottom-sheet-title']")).toContainText("アイテムを追加")

    // アイテム名を入力
    await page.locator("[data-testid='item-name-input']").fill("牛乳")

    // 「追加して閉じる」をクリック
    await page.locator("[data-testid='item-add-close']").click()

    // BottomSheetが閉じるのを待つ
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // アイテムが一覧に表示される
    await expect(page.locator("[data-testid='item-list']")).toBeVisible()
    await expect(page.locator("[data-testid='item-list']")).toContainText("牛乳")
  })

  test("A-3: 連続追加できる", async ({ page }) => {
    // FABをクリック
    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)

    // 1つ目のアイテムを「追加して続ける」で追加
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-continue']").click()

    // フォームがリセットされていることを確認
    await expect(page.locator("[data-testid='item-name-input']")).toHaveValue("")

    // 2つ目のアイテムを「追加して閉じる」で追加
    await page.locator("[data-testid='item-name-input']").fill("パン")
    await page.locator("[data-testid='item-add-close']").click()

    // BottomSheetが閉じる
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // 両方のアイテムが表示される
    const itemList = page.locator("[data-testid='item-list']")
    await expect(itemList).toContainText("牛乳")
    await expect(itemList).toContainText("パン")
  })

  test("A-4: 数量変更付きアイテム追加", async ({ page }) => {
    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)

    await page.locator("[data-testid='item-name-input']").fill("卵")

    // 数量を3に変更
    await page.locator("[data-testid='quantity-increase']").click()
    await page.locator("[data-testid='quantity-increase']").click()
    await expect(page.locator("[data-testid='quantity-display']")).toContainText("3")

    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // 数量が表示される
    await expect(page.locator("[data-testid='item-list']")).toContainText("卵")
    await expect(page.locator("[data-testid='item-list']")).toContainText("x3")
  })

  test("A-5: メモ付きアイテム追加", async ({ page }) => {
    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)

    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-memo-input']").fill("低脂肪タイプ")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // メモが表示される
    await expect(page.locator("[data-testid='item-list']")).toContainText("低脂肪タイプ")
  })

  test("A-8: アイテムを編集できる", async ({ page }) => {
    // まずアイテムを追加
    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // アイテムをタップして編集シートを開く
    await page.locator("[data-testid='item-list']").getByText("牛乳").click()
    await waitForBottomSheet(page)

    // タイトルが「アイテムを編集」であることを確認
    await expect(page.locator("[data-testid='bottom-sheet-title']")).toContainText("アイテムを編集")

    // 名前を変更
    await page.locator("[data-testid='item-name-input']").clear()
    await page.locator("[data-testid='item-name-input']").fill("豆乳")

    // 更新
    await page.locator("[data-testid='item-submit']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // 名前が変更されている
    await expect(page.locator("[data-testid='item-list']")).toContainText("豆乳")
    await expect(page.locator("[data-testid='item-list']")).not.toContainText("牛乳")
  })

  test("A-9: アイテムを削除できる", async ({ page }) => {
    // まずアイテムを追加
    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // アイテムをタップして編集シートを開く
    await page.locator("[data-testid='item-list']").getByText("牛乳").click()
    await waitForBottomSheet(page)

    // 削除ボタンをクリック
    await page.locator("[data-testid='item-delete-button']").click()

    // 確認ダイアログが表示される
    await expect(page.locator("[data-testid='item-delete-confirm']")).toBeVisible()

    // 「削除する」をクリック
    await page.locator("[data-testid='item-delete-confirm-yes']").click()

    // BottomSheetが閉じる
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // 空状態に戻る
    await expect(page.locator("[data-testid='home-empty-state']")).toBeVisible()
  })

  test("A-10: 検索フィルタリング", async ({ page }) => {
    // 2つアイテムを追加
    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)
    await page.locator("[data-testid='item-name-input']").fill("牛乳")
    await page.locator("[data-testid='item-add-continue']").click()
    await expect(page.locator("[data-testid='item-name-input']")).toHaveValue("")
    await page.locator("[data-testid='item-name-input']").fill("パン")
    await page.locator("[data-testid='item-add-close']").click()
    await expect(page.locator("[data-testid='bottom-sheet']")).toBeHidden()

    // 検索
    await page.locator("[data-testid='search-input']").fill("牛")
    await expect(page.locator("[data-testid='item-list']")).toContainText("牛乳")
    await expect(page.locator("[data-testid='item-list']")).not.toContainText("パン")

    // クリア
    await page.locator("[data-testid='search-clear']").click()
    await expect(page.locator("[data-testid='item-list']")).toContainText("牛乳")
    await expect(page.locator("[data-testid='item-list']")).toContainText("パン")
  })
})
