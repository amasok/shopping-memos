import { type Page } from "@playwright/test"

/**
 * IndexedDB (Dexie ShoppingMemosDB) のヘルパー関数群
 * ゲストモード（未ログイン）でのE2Eテスト用
 */

/** IndexedDBの全テーブルをクリア */
export async function clearDatabase(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbName = "ShoppingMemosDB"
    const request = indexedDB.open(dbName)
    return new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const db = request.result
        const storeNames = Array.from(db.objectStoreNames)
        if (storeNames.length === 0) {
          db.close()
          resolve()
          return
        }
        const tx = db.transaction(storeNames, "readwrite")
        for (const name of storeNames) {
          tx.objectStore(name).clear()
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }
      request.onerror = () => reject(request.error)
    })
  })
}

/** IndexedDBのテーブルにレコードを追加 */
export async function seedTable(
  page: Page,
  tableName: string,
  records: Record<string, unknown>[]
): Promise<void> {
  await page.evaluate(
    async ({ tableName, records }) => {
      const dbName = "ShoppingMemosDB"
      const request = indexedDB.open(dbName)
      return new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(tableName, "readwrite")
          const store = tx.objectStore(tableName)
          for (const record of records) {
            store.put(record)
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
        request.onerror = () => reject(request.error)
      })
    },
    { tableName, records }
  )
}

/** ページ遷移してDBをクリアし、指定のページに遷移する */
export async function setupCleanPage(page: Page, path = "/"): Promise<void> {
  // まずトップページに遷移してDBを初期化
  await page.goto("/")
  await clearDatabase(page)
  // 対象ページに遷移
  if (path !== "/") {
    await page.goto(path)
  } else {
    await page.reload()
  }
}

/** BottomSheetが開くのを待つ */
export async function waitForBottomSheet(page: Page): Promise<void> {
  await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "visible" })
}

/** BottomSheetが閉じるのを待つ */
export async function waitForBottomSheetClose(page: Page): Promise<void> {
  await page.locator("[data-testid='bottom-sheet']").waitFor({ state: "hidden" })
}
