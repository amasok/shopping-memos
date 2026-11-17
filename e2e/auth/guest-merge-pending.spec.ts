import { test, expect, type Page } from "@playwright/test"
import { loginWithOtp } from "./fixtures/auth-helpers"
import { trpcQuery } from "./fixtures/trpc-helpers"
import { seedTable } from "../fixtures/test-helpers"
import { createItem } from "../fixtures/test-data"

/**
 * #144: merge で取り込めなかったものだけを、アカウントごとに端末に残す（実 DB・実ブラウザの IndexedDB）
 *
 * - 取り込めた分は消え、取り込めなかったものだけが pendingMerge に移る（ゲストの画面には出ない）
 * - 別のアカウントでログインしても、その分は送られない（アカウントごと）
 * - 「破棄する」で消える
 *
 * 取り込めないレコードは、日付が不正な 1 件（サーバーの検証でスキップされる）で作る
 */

test.use({ storageState: { cookies: [], origins: [] } })

const suffix = Date.now().toString(36)
const ACCOUNT_P = `pending-p-${suffix}@e2e-test.local`
const ACCOUNT_Q = `pending-q-${suffix}@e2e-test.local`

/** IndexedDB（Dexie の ShoppingMemosDB）のテーブルの全レコード。DB やテーブルがまだなければ null（空の DB は作らない） */
async function readTable(page: Page, table: string): Promise<Array<Record<string, unknown>> | null> {
  return page.evaluate(
    (name) =>
      new Promise<Array<Record<string, unknown>> | null>((resolve) => {
        const req = indexedDB.open("ShoppingMemosDB")
        req.onupgradeneeded = () => req.transaction?.abort()
        req.onerror = () => resolve(null)
        req.onsuccess = () => {
          const db = req.result
          try {
            const all = db.transaction(name, "readonly").objectStore(name).getAll()
            all.onsuccess = () => {
              db.close()
              resolve(all.result)
            }
            all.onerror = () => {
              db.close()
              resolve(null)
            }
          } catch {
            db.close()
            resolve(null)
          }
        }
      }),
    table
  )
}

const rowCount = async (page: Page, table: string) => (await readTable(page, table))?.length ?? -1

async function waitForGuestDb(page: Page) {
  await expect.poll(() => rowCount(page, "tags")).toBeGreaterThan(0)
}

async function loginAndMerge(page: Page, email: string) {
  await loginWithOtp(page, email)
  await page.goto("/")
  await expect
    // merge の後に画面を読み込み直すことがあるので、その間の evaluate の失敗は「まだ」として待ち続ける
    .poll(
      () =>
        page
          .evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("data-merge-completed-")))
          .catch(() => false),
      { timeout: 30_000 }
    )
    .toBe(true)
  await page.waitForLoadState("networkidle")
}

async function serverItemNames(page: Page): Promise<string[]> {
  const items = await trpcQuery<Array<{ name: string }>>(page.request, "catalog.getItems", { includePurchased: true })
  return items.map((i) => i.name)
}

async function logout(page: Page) {
  await page.goto("/settings")
  await page.getByTestId("logout-button").click()
  await page.getByRole("button", { name: "ログアウト" }).last().click()
  await page.waitForURL("/")
  await page.waitForLoadState("networkidle")
}

test("取り込めなかったものだけがアカウントごとに残り、ゲストの画面には出ず、別のアカウントでは送られず、破棄で消える", async ({ page }) => {
  // 同じアドレスに 2 回ログインするので、再送の間隔（60 秒）を待つことがある（#61 A3a）
  test.setTimeout(240_000)
  const good = `取り込める-${suffix}`
  const bad = `取り込めない-${suffix}`

  // 1. ゲストで、正常なアイテムと、サーバーで取り込めない（日付が不正な）アイテムを入れる
  await page.goto("/")
  await waitForGuestDb(page)
  await seedTable(page, "items", [
    createItem({ name: good }),
    { ...createItem({ name: bad }), createdAt: "not-a-date" },
  ])

  // 2. アカウント P でログインすると merge される。取り込めた分は消え、取り込めなかった 1 件だけが pendingMerge に移る
  await loginAndMerge(page, ACCOUNT_P)
  expect(await serverItemNames(page)).toContain(good)
  expect(await serverItemNames(page)).not.toContain(bad)
  await expect.poll(() => rowCount(page, "items")).toBe(0)
  await expect.poll(() => rowCount(page, "pendingMerge")).toBe(1)
  await expect(page.getByTestId("merge-skipped-notice")).toContainText("1件")

  // 3. ログアウトすると、ゲストの画面には取り込めなかったものも出ない（通常のテーブルは空）
  await logout(page)
  await waitForGuestDb(page)
  await expect(page.getByText(bad)).toHaveCount(0)
  await expect(page.getByText(good)).toHaveCount(0)
  expect(await rowCount(page, "items")).toBe(0)
  // ログアウトでは、アカウントの pendingMerge は触らない
  expect(await rowCount(page, "pendingMerge")).toBe(1)

  // 4. 別のアカウント Q でログインしても、P の分は送られず、残ったまま
  await loginAndMerge(page, ACCOUNT_Q)
  expect(await serverItemNames(page)).not.toContain(bad)
  expect(await serverItemNames(page)).not.toContain(good)
  expect(await rowCount(page, "pendingMerge")).toBe(1)
  await logout(page)
  await waitForGuestDb(page)

  // 5. P で再ログインすると、残っていた分をもう一度送る（今回も取り込めないので、残って通知が出る）。「破棄する」で消える
  await loginAndMerge(page, ACCOUNT_P)
  await expect(page.getByTestId("merge-skipped-notice")).toBeVisible()
  await page.getByTestId("merge-skipped-discard").click()
  // 取り消せない削除なので、確認が出る（件数と、元に戻せないこと）。確認してから消す
  const confirm = page.getByRole("dialog")
  await expect(confirm).toContainText("取り込めなかった 1 件を破棄します。元に戻せません。")
  await confirm.getByRole("button", { name: "破棄する" }).click()
  await expect(page.getByTestId("merge-skipped-notice")).toHaveCount(0)
  await expect.poll(() => rowCount(page, "pendingMerge")).toBe(0)
  expect(await serverItemNames(page)).not.toContain(bad)
  // 取り込めた分は、二重にならない
  expect((await serverItemNames(page)).filter((n) => n === good)).toHaveLength(1)
})
