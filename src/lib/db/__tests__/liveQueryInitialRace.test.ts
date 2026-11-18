// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { liveQuery } from "dexie"
import { ShoppingMemosDB, type ShoppingItem } from "@/lib/db"
import { queryItems } from "@/hooks/data/catalogQueries"

/**
 * liveQuery の最初の読み込みと重なった書き込み（#185・#183）
 *
 * 画面の一覧（useLiveQuery）の最初の読み込みの途中に、別の書き込み（同期の pull・ほかのタブ・移行など）が確定しても、
 * 古い結果のまま残らず、書き込みの後の結果が届くこと。Dexie 4.2.1 では、最初の読み込みが終わるまで書き込みを監視せず、
 * 途中の変更を捨てていたため、古い結果が残った（4.4 で、監視を先に始め、読み終えたときに途中の変更を確かめるようになった）。
 * 2 つ目のテストは 4.2.1 で落ちることを確かめた（古い空の結果のまま届かない）
 */

let db: ShoppingMemosDB

const item = (id: string, name: string): ShoppingItem => ({
  id,
  name,
  quantity: 1,
  tagIds: [],
  createdAt: new Date(),
  updatedAt: new Date(),
})

beforeEach(() => {
  db = new ShoppingMemosDB(`livequery-race-test-${crypto.randomUUID()}`)
})

afterEach(async () => {
  await db.delete()
})

/** liveQuery の結果を、条件を満たすまで待つ（来なければ timeoutMs で失敗） */
function waitForResult<T>(querier: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 1000): Promise<T[]> {
  const seen: T[] = []
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.unsubscribe()
      reject(new Error(`期待した結果が届かなかった。届いた結果: ${JSON.stringify(seen)}`))
    }, timeoutMs)
    const subscription = liveQuery(querier).subscribe({
      next: (value) => {
        seen.push(value)
        if (done(value)) {
          clearTimeout(timer)
          subscription.unsubscribe()
          resolve(seen)
        }
      },
      error: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
  })
}

/**
 * 最初の読み込みの途中に、外側（別の処理）で書き込みを確定させるための仕掛け。
 * querier は、最初の 1 回だけ、読んだ後に readDone を知らせ、外側の書き込みが終わる（release）まで待つ
 */
/** liveQuery の文脈（Dexie の PSD）の外で書き込む（readDone の続きは querier の文脈を引き継ぐため、タイマーで抜ける） */
function outside<T>(write: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => setTimeout(() => write().then(resolve, reject), 0))
}

function interleave() {
  let first = true
  let signalRead!: () => void
  let release!: () => void
  const readDone = new Promise<void>((r) => (signalRead = r))
  const released = new Promise<void>((r) => (release = r))
  return {
    readDone,
    release,
    /** querier の中で、読んだ後に呼ぶ */
    async pauseOnce() {
      if (!first) return
      first = false
      signalRead()
      await released
    },
  }
}

describe("liveQuery の最初の読み込みと重なった書き込み（#185）", () => {
  it("最初の読み込みで商品を読んだ後、読み終える前に商品が消えても、消えた後の結果が届く", async () => {
    await db.items.add(item("old", "以前のアイテム"))
    const gate = interleave()

    const pending = waitForResult(
      async () => {
        const items = await db.items.toArray()
        await gate.pauseOnce()
        await db.lists.toArray()
        return items.map((i) => i.name)
      },
      (names) => names.length === 0
    )
    // 商品を読んだ後、読み終える前に、別の書き込み（移行の clear・pull など）が確定する
    await gate.readDone
    await outside(() => db.items.clear())
    gate.release()

    expect((await pending).at(-1)).toEqual([])
  })

  it("一覧の読み取り（queryItems）でも、最初の読み込みの途中に足された商品が届く", async () => {
    const gate = interleave()

    const pending = waitForResult(
      async () => {
        const items = await queryItems(db, { groupId: undefined })
        await gate.pauseOnce()
        return items.map((i) => i.name)
      },
      (names) => names.includes("あとから足した商品")
    )
    await gate.readDone
    await outside(() => db.items.add(item("new", "あとから足した商品")))
    gate.release()

    expect((await pending).at(-1)).toEqual(["あとから足した商品"])
  })
})
