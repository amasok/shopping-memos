import { db } from "./index"
import { DEFAULT_TAG_NAMES } from "./tags"

/**
 * ゲストのデータ（IndexedDB）とログインの関係（offline-support.md「ゲストのデータとログイン・ログアウト」）
 *
 * - ログインのたびに、ゲストのデータがあれば sync.merge で送る
 * - 全部取り込めたら、ゲストのデータを空にする。取り込めなかったものが 1 件でもあれば、全部残す（次のログインで送り直す）
 * - ログアウトしたら（またはセッションが切れてゲストに戻ったら）、ログイン中だけの状態（merge 済みの印・選んでいたグループ）を消す
 */

/** このログインの間は merge 済み、という印（ゲストに戻ったら消す） */
export const MERGE_COMPLETED_KEY = "data-merge-completed"
/** 選んでいたグループ（GroupContext） */
export const SELECTED_GROUP_KEY = "selectedGroupId"

export interface GuestSnapshot {
  tags: Array<{ name: string }>
  items: unknown[]
  lists: unknown[]
  listItems: unknown[]
}

/**
 * 送る必要のあるゲストのデータがあるか。
 * 初期タグ（食品・日用品・エンタメ）だけのときは送らない（ゲストに戻るたびに作り直されるため）
 */
export function hasGuestDataToMerge(snapshot: GuestSnapshot): boolean {
  if (snapshot.items.length > 0 || snapshot.lists.length > 0 || snapshot.listItems.length > 0) return true
  const defaults: readonly string[] = DEFAULT_TAG_NAMES
  return snapshot.tags.some((tag) => !defaults.includes(tag.name))
}

/** merge が終わったゲストのデータを消す（次に開いたときに、初期タグだけが作り直される） */
export async function clearGuestData(): Promise<void> {
  await db.transaction("rw", [db.tags, db.items, db.lists, db.listItems, db.table("history")], async () => {
    await Promise.all([
      db.tags.clear(),
      db.items.clear(),
      db.lists.clear(),
      db.listItems.clear(),
      db.table("history").clear(),
    ])
  })
}

/** ログイン中だけの状態（merge 済みの印・選んでいたグループ）を消す。ログアウトのとき・ゲストに戻ったときに呼ぶ */
export function clearLoginScopedState(storage: Storage = localStorage): void {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(`${MERGE_COMPLETED_KEY}-`)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
  storage.removeItem(SELECTED_GROUP_KEY)
}
