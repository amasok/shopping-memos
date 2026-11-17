import { test, expect, type Page } from "@playwright/test"
import { createItem, createList } from "./fixtures/test-data"
import { seedTable } from "./fixtures/test-helpers"

/**
 * 以前の仕組みの端末（merge 済みの印 data-merge-completed-<uid> があり、guest-data-version がない）で開くと、
 * ゲストのデータを送らずに一度だけ空にし、初期タグだけに戻す（offline-support.md「4b」）。
 * 実ブラウザの IndexedDB（Dexie の実物）で確かめる
 */

const LEGACY_MARK = "data-merge-completed-legacy-user"
const VERSION_KEY = "guest-data-version"

/**
 * ゲストの DB（IndexedDB）を、読み取り専用で開く。
 * まだアプリが DB を作っていないときに、空の DB を作ってしまわないよう、作成（upgrade）が必要なら中止して null を返す。
 * テーブルがまだない場合も null を返す（待っているうちにアプリが作る）
 */
async function readAll(page: Page, table: string): Promise<unknown[] | null> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[] | null>((resolve) => {
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

/** ゲストの DB のテーブルの件数（DB がまだなければ -1） */
async function countRows(page: Page, table: string): Promise<number> {
  return (await readAll(page, table))?.length ?? -1
}

async function tagNames(page: Page): Promise<string[]> {
  const rows = ((await readAll(page, "tags")) ?? []) as Array<{ name: string }>
  return rows.map((t) => t.name).sort()
}

/** 初期タグが作られる（DBProvider の初期化が終わる）まで待つ */
async function waitForDefaultTags(page: Page) {
  await expect.poll(() => countRows(page, "tags")).toBeGreaterThan(0)
}

/**
 * アプリのページから離れる（同じオリジンの API の URL を開く。#183）。
 * 最初のページは、認証の確認が終わった後（ゲストのとき）に、ログイン中だけの状態（merge 済みの印）を消す。
 * アプリのページのまま以前の印を付けると、その後始末と競合して印が消え、移行が走らないことがあるので、
 * アプリの JS が動いていない状態で IndexedDB と localStorage を仕込んでから、アプリを開く
 */
async function leaveApp(page: Page) {
  await page.goto("/api/version")
}

const DEFAULT_TAGS = ["エンタメ", "日用品", "食品"]

test.describe("以前の仕組みの端末からの移行 (ゲスト)", () => {
  test("以前の印があれば、ゲストのデータ（アイテム・リスト）を消して初期タグだけに戻し、バージョンを付ける。印は消える", async ({
    page,
  }) => {
    await page.goto("/")
    await waitForDefaultTags(page)
    await leaveApp(page)
    const list = createList({ name: "以前のリスト" })
    await seedTable(page, "items", [createItem({ name: "以前のアイテム" })])
    await seedTable(page, "lists", [list])
    await page.evaluate(
      ([mark, key]) => {
        localStorage.setItem(mark, "true")
        localStorage.removeItem(key)
      },
      [LEGACY_MARK, VERSION_KEY]
    )

    await page.goto("/")

    await expect.poll(() => countRows(page, "items")).toBe(0)
    expect(await countRows(page, "lists")).toBe(0)
    await expect.poll(() => tagNames(page)).toEqual(DEFAULT_TAGS)
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), VERSION_KEY)).toBe("2")
    // ゲストに戻っている端末では、以前の印も消える
    await expect.poll(() => page.evaluate((mark) => localStorage.getItem(mark), LEGACY_MARK)).toBeNull()
    await expect(page.getByText("以前のアイテム")).toHaveCount(0)
  })

  test("以前の印がなければ（普通のゲスト）、データはそのまま残り、バージョンだけが付く", async ({ page }) => {
    await page.goto("/")
    await waitForDefaultTags(page)
    await seedTable(page, "items", [createItem({ name: "残るアイテム" })])
    await page.evaluate((key) => localStorage.removeItem(key), VERSION_KEY)

    await page.reload()

    await expect(page.getByText("残るアイテム")).toBeVisible()
    expect(await countRows(page, "items")).toBe(1)
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), VERSION_KEY)).toBe("2")
  })

  test("移行済み（バージョン 2）なら、印があっても（新しい意味の印）データは消さない", async ({ page }) => {
    await page.goto("/")
    await waitForDefaultTags(page)
    await leaveApp(page)
    await seedTable(page, "items", [createItem({ name: "消えないアイテム" })])
    await page.evaluate(
      ([mark, key]) => {
        localStorage.setItem(mark, "true")
        localStorage.setItem(key, "2")
      },
      [LEGACY_MARK, VERSION_KEY]
    )

    await page.goto("/")

    await expect(page.getByText("消えないアイテム")).toBeVisible()
    expect(await countRows(page, "items")).toBe(1)
  })

  test("移行は一度だけ。移行後に入れたデータは、再読み込みしても消えない", async ({ page }) => {
    await page.goto("/")
    await waitForDefaultTags(page)
    await leaveApp(page)
    await page.evaluate(
      ([mark, key]) => {
        localStorage.setItem(mark, "true")
        localStorage.removeItem(key)
      },
      [LEGACY_MARK, VERSION_KEY]
    )
    await page.goto("/")
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), VERSION_KEY)).toBe("2")
    await waitForDefaultTags(page)

    await seedTable(page, "items", [createItem({ name: "移行後のアイテム" })])
    await page.reload()

    await expect(page.getByText("移行後のアイテム")).toBeVisible()
  })
})
