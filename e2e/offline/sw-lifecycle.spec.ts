import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test"
import { createItem } from "../fixtures/test-data"
import { seedTable } from "../fixtures/test-helpers"

/**
 * SW のライフサイクル E2E（O-9 / O-10 / O-14）。
 *
 * ビルドを切り替えながら、同じブラウザプロファイル（SW・Cache Storage・IndexedDB）を使い回すため、
 * `scripts/e2e-sw-lifecycle.sh` から段階（SW_STAGE）ごとに実行する。単体では実行しない（スキップされる）。
 *
 * | SW_STAGE        | サーバーのビルド                     | 確認すること |
 * |-----------------|--------------------------------------|--------------|
 * | prime           | 通常（v1）                           | SW が登録され sm- のキャッシュができる。IndexedDB にアイテムを入れる |
 * | update          | 通常（v2。v1 のプロファイルを使う）  | O-9: 更新トーストが出て、［更新］でリロードされ、新しい SW が有効になる |
 * | kill-disabled   | NEXT_PUBLIC_SW_ENABLED=false         | O-10 段階 1: 登録が 0 件、sm- / serwist- のキャッシュが空、ページが読める |
 * | kill-switch     | SW_KILL_SWITCH=true                  | O-10 段階 2: 同上 |
 *
 * O-14（強制更新）はここでは扱わない。更新後はどのページも新しいビルドの HTML をネットワークから受け取るため、
 * 「古いビルドのページが開いたまま」という状況をテストから作れない（`page.route` は SW 経由の
 * /api/version を横取りできない）。モーダルの表示は service-worker.spec.ts の O-14（簡易）、更新の動作は
 * ForceUpdateModal / useServiceWorkerUpdate の単体テストで確認する。
 */

const STAGE = process.env.SW_STAGE
const PROFILE = process.env.SW_PROFILE
const BASE = "http://localhost:3100"
const ITEM_NAME = "ライフサイクル確認アイテム"

test.skip(!STAGE || !PROFILE, "SW_STAGE / SW_PROFILE が未設定（scripts/e2e-sw-lifecycle.sh から実行する）")

async function open(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await chromium.launchPersistentContext(PROFILE!, { headless: true })
  const page = context.pages()[0] ?? (await context.newPage())
  return { context, page }
}

const registrations = (page: Page) =>
  page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)

const appCaches = (page: Page) =>
  page.evaluate(async () =>
    (await caches.keys()).filter((n) => n.startsWith("sm-") || n.startsWith("serwist-"))
  )

const itemNamesInDb = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open("ShoppingMemosDB")
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const all = db.transaction("items").objectStore("items").getAll()
          all.onsuccess = () => {
            db.close()
            resolve((all.result as { name: string }[]).map((i) => i.name))
          }
          all.onerror = () => reject(all.error)
        }
      })
  )

test.describe(`SW ライフサイクル (${STAGE})`, () => {
  test("prime: SW を登録し、キャッシュと IndexedDB のデータを作る", async () => {
    test.skip(STAGE !== "prime")
    const { context, page } = await open()
    try {
      await page.goto(`${BASE}/`)
      await page.evaluate(() => navigator.serviceWorker.ready)
      await page.reload()
      await page.waitForFunction(() => !!navigator.serviceWorker.controller)
      await seedTable(page, "items", [createItem({ name: ITEM_NAME })])

      expect(await registrations(page)).toBe(1)
      expect((await appCaches(page)).some((n) => n.startsWith("serwist-precache"))).toBe(true)
      expect(await itemNamesInDb(page)).toContain(ITEM_NAME)
    } finally {
      await context.close()
    }
  })

  test("O-9: 新しいビルドで更新トーストが出て、［更新］でリロードされ新しい SW が有効になる", async () => {
    test.skip(STAGE !== "update")
    const { context, page } = await open()
    try {
      await page.goto(`${BASE}/`)

      // 新しい SW は waiting で待ち、トーストが出る
      await expect(page.getByTestId("update-available-toast")).toBeVisible({ timeout: 30_000 })
      const before = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        ;(window as unknown as { __marker: number }).__marker = 1
        return { waiting: !!reg?.waiting, active: reg?.active?.scriptURL }
      })
      expect(before.waiting).toBe(true)

      // ［更新］で SKIP_WAITING が送られ、新しい SW が有効になってリロードされる
      await page.getByTestId("update-available-button").click()
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker), {
          timeout: 30_000,
        })
        .toBeUndefined()

      await page.waitForFunction(() => !!navigator.serviceWorker.controller)
      const after = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        return { waiting: !!reg?.waiting, active: !!reg?.active }
      })
      expect(after).toEqual({ waiting: false, active: true })
      await expect(page.getByTestId("update-available-toast")).toHaveCount(0)
      // IndexedDB のデータは更新後も残る
      expect(await itemNamesInDb(page)).toContain(ITEM_NAME)
    } finally {
      await context.close()
    }
  })

  for (const [stage, label] of [
    ["kill-disabled", "段階 1: NEXT_PUBLIC_SW_ENABLED=false"],
    ["kill-switch", "段階 2: SW_KILL_SWITCH=true"],
  ] as const) {
    test(`O-10 ${label}: 登録が解除され、sm- / serwist- のキャッシュが空になり、ページが通常どおり読める`, async () => {
      test.skip(STAGE !== stage)
      const { context, page } = await open()
      try {
        const res = await page.goto(`${BASE}/`)
        expect(res?.status()).toBe(200)

        // 自己解除は非同期で、自己消去 SW はページを自分でリロードさせる（落ち着くまで数秒かかる）。
        // ここではリロードを重ねず、ナビゲーション中の失敗は次の確認で再試行する
        await expect
          .poll(
            async () => {
              try {
                return await registrations(page)
              } catch {
                return null
              }
            },
            { timeout: 30_000, intervals: [1000, 2000, 2000] }
          )
          .toBe(0)

        // 解除された旧 SW が、解除の直後に書いたキャッシュ（sm-v1-rsc など）が残ることがある。次の表示までには消える。
        // 段階 2 のビルドでは、表示のたびに自己消去 SW が登録され、すぐ自分で解除される（残り続けない）
        await page.reload()
        await expect
          .poll(
            async () => {
              try {
                return { regs: await registrations(page), caches: await appCaches(page) }
              } catch {
                return null
              }
            },
            { timeout: 30_000, intervals: [1000, 2000, 2000] }
          )
          .toEqual({ regs: 0, caches: [] })

        await expect(page.getByText("買いたいもの").first()).toBeVisible()
        // 解除してもローカルデータは消さない
        expect(await itemNamesInDb(page)).toContain(ITEM_NAME)
      } finally {
        await context.close()
      }
    })
  }
})
