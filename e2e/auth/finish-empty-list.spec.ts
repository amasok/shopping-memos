import { test, expect, type Page } from "@playwright/test"
import { seedItems, getUser, skipDataMerge, testUUID } from "./fixtures/db-helpers"
import { USER_A_EMAIL } from "./fixtures/auth-helpers"

/**
 * チェック 0 件の完了（ログイン中。#179 の 179b。openspec の shopping「チェック 0 件の完了」）
 *
 * ほかのテストのデータと混ざらないよう、名前は毎回ユニークにする
 */

const suffix = Date.now().toString(36)
const name = (label: string) => `${label}-${suffix}`

let userA: { id: string }

/** 個人モード（グループを選んでいない）で、DataMerge をスキップして開く */
async function openPersonal(page: Page, userId: string) {
  await page.goto("/")
  await skipDataMerge(page, userId)
  await page.evaluate(() => localStorage.setItem("selectedGroupId", "undefined"))
  await page.goto("/")
}

/** 既存のアイテムを選んでリストを作り、リスト詳細に遷移する。リストの ID を返す */
async function createListFrom(page: Page, itemNames: string[]) {
  await page.goto("/lists/new")
  await page.getByTestId("existing-items-list").waitFor({ state: "visible", timeout: 15000 })
  for (const n of itemNames) {
    await page.getByTestId("existing-items-list").locator("label").filter({ hasText: n }).click()
  }
  await page.getByTestId("item-selector-submit").click()
  await expect(page).toHaveURL(/\/lists\/detail\?id=/, { timeout: 15000 })
  await page.getByTestId("unchecked-section").waitFor({ state: "visible", timeout: 15000 })
  return new URL(page.url()).searchParams.get("id")!
}

test.describe("チェック 0 件の完了（ログイン中）", () => {
  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
  })

  test("リストの商品ごと消すとリストと同じ名前の未購入の商品を削除する", async ({ page }) => {
    const names = [name("ごと1"), name("ごと2")]
    await seedItems({ userId: userA.id, items: names.map((n) => ({ id: testUUID(), name: n })) })
    await openPersonal(page, userA.id)
    for (const n of names) await expect(page.getByTestId("item-list")).toContainText(n)
    const listId = await createListFrom(page, names)

    await page.getByTestId("partial-complete-button").click()
    await page.getByTestId("no-checked-dialog").waitFor({ state: "visible" })
    await page.getByTestId("no-checked-delete-with-items").click()

    await expect(page).toHaveURL(/\/lists$/, { timeout: 15000 })
    await expect(
      page.locator("[data-testid^='list-item-']").first().or(page.getByTestId("lists-empty-state"))
    ).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId(`list-item-${listId}`)).toHaveCount(0)
    // カタログの商品も消え、「買いたいもの」の一覧に戻らない
    await page.goto("/")
    await expect(page.getByTestId("item-list").or(page.getByTestId("home-empty-state"))).toBeVisible({ timeout: 15000 })
    for (const n of names) await expect(page.getByText(n)).toHaveCount(0)
    // 購入履歴は作られない
    await page.goto("/history")
    await expect(page.getByTestId("history-list").or(page.getByTestId("history-empty-state"))).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId(`history-item-${listId}`)).toHaveCount(0)
  })
})
