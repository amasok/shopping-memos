import { test, expect, type Page } from "@playwright/test"
import { loginWithCredentials } from "./fixtures/auth-helpers"
import { trpcQuery } from "./fixtures/trpc-helpers"
import { seedTable } from "../fixtures/test-helpers"
import { createItem } from "../fixtures/test-data"

/**
 * ゲストのデータとログイン・ログアウト（offline-support.md「ゲストのデータとログイン・ログアウト」）
 * ログイン → merge → ログアウト → ゲストで追加 → 再ログイン の流れを、実際の画面と実 DB で確かめる
 *
 * ほかのテストのデータと混ざらないよう、このテスト専用の E2E ユーザーを使う（Credentials のログインで作られる）
 */
const EMAIL = "guest-lifecycle@e2e-test.local"

// ログインしていない（ゲストの）状態から始める
test.use({ storageState: { cookies: [], origins: [] } })

/** ゲストの DB（IndexedDB）のテーブルの件数 */
async function countGuestRows(page: Page, table: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("ShoppingMemosDB")
        req.onsuccess = () => {
          const db = req.result
          const count = db.transaction(name, "readonly").objectStore(name).count()
          count.onsuccess = () => {
            db.close()
            resolve(count.result)
          }
          count.onerror = () => reject(count.error)
        }
        req.onerror = () => reject(req.error)
      }),
    table
  )
}

/** 初期タグが作られる（DBProvider の初期化が終わる）まで待つ */
async function waitForGuestDb(page: Page) {
  await expect.poll(() => countGuestRows(page, "tags")).toBeGreaterThan(0)
}

/** ログインして画面を開き、merge が終わる（このログインの印が付く）まで待つ */
async function loginAndMerge(page: Page) {
  await loginWithCredentials(page, EMAIL)
  await page.goto("/")
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("data-merge-completed-"))), {
      timeout: 30_000,
    })
    .toBe(true)
  await page.waitForLoadState("networkidle")
}

/** サーバーにある、この名前のアイテムの件数 */
async function serverItemCount(page: Page, name: string): Promise<number> {
  const items = await trpcQuery<Array<{ name: string }>>(page.request, "catalog.getItems", {
    searchText: name,
    includePurchased: true,
  })
  return items.filter((i) => i.name === name).length
}

async function logout(page: Page) {
  await page.goto("/settings")
  await page.getByTestId("logout-button").click()
  // 確認ダイアログの「ログアウト」
  await page.getByRole("button", { name: "ログアウト" }).last().click()
  await page.waitForURL("/")
  await page.waitForLoadState("networkidle")
}

test("ログイン → merge → ログアウト → ゲストで追加 → 再ログイン で、ゲストのデータが毎回引き継がれ、ログアウト後は空のゲストになる", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const suffix = Date.now().toString(36)
  const first = `ゲスト1-${suffix}`
  const second = `ゲスト2-${suffix}`

  // 1. ゲストでアイテムを入れる
  await page.goto("/")
  await waitForGuestDb(page)
  await seedTable(page, "items", [createItem({ name: first })])

  // 2. ログインすると merge され、ゲストのデータは空になる
  await loginAndMerge(page)
  expect(await serverItemCount(page, first)).toBe(1)
  await expect.poll(() => countGuestRows(page, "items")).toBe(0)
  await expect(page.getByText(first)).toBeVisible()

  // 3. ログアウトすると、空のゲスト（初期タグだけ）になり、ログイン前のデータもログイン中のデータも見えない
  await logout(page)
  await waitForGuestDb(page)
  await expect(page.getByText(first)).toHaveCount(0)
  await expect.poll(() => countGuestRows(page, "items")).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem("selectedGroupId"))).toBeNull()

  // 4. ゲストでまたアイテムを入れて、もう一度ログインすると、それも merge される（2 回目以降のログインも送る）
  await seedTable(page, "items", [createItem({ name: second })])
  await loginAndMerge(page)
  expect(await serverItemCount(page, second)).toBe(1)
  // 1 回目のアイテムは二重にならない
  expect(await serverItemCount(page, first)).toBe(1)
  await expect.poll(() => countGuestRows(page, "items")).toBe(0)

  // 5. 初期タグは、ログインのたびに二重にならない（同じ名前の自分のタグにまとめる）
  const tags = await trpcQuery<Array<{ name: string }>>(page.request, "catalog.getTags", {})
  expect(tags.filter((t) => t.name === "食品")).toHaveLength(1)
})
