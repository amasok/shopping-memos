import { db } from "./index"
import { DEFAULT_TAG_NAMES, initializeDefaultTags } from "./tags"

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
/**
 * この端末のゲストのデータの扱いのバージョン。
 * "2" より前（キーがない）は、merge 済みの印が「このユーザーは一度 merge した（以後は送らない）」という以前の意味だった
 */
export const GUEST_DATA_VERSION_KEY = "guest-data-version"
export const GUEST_DATA_VERSION = "2"

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

/**
 * ゲストのデータを消して、初期タグだけの状態に戻す。
 * 消すテーブルは、DB の現在のスキーマ（db.tables）から取る。決め打ちにすると、廃止したテーブル（v8 の history）を
 * 指定して InvalidTableError になったり、追加したテーブルを消し忘れたりする
 */
export async function clearGuestData(): Promise<void> {
  const tables = db.tables
  await db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((table) => table.clear()))
  })
  await initializeDefaultTags()
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

/**
 * 以前の仕組みからの移行（一度だけ。offline-support.md「4b」）
 *
 * 以前は merge の後もゲストのデータを消さず、merge 済みの印があると二度と送らなかった。
 * 印が残っている端末のゲストのデータを、新しい仕組みのまま次のログインで送ると、
 * サーバーで消したアイテムやリストがまとめて戻ってしまう。そこで、以前の印がある端末では、
 * 一度だけゲストのデータを送らずに空にする（初期タグだけの状態に戻す）。
 * 移行したら（以前の印がなくても）バージョンのキーを付け、新しい意味の印と取り違えないようにする
 */
export async function migrateLegacyGuestData(storage: Storage = localStorage): Promise<"cleared" | "none"> {
  if (storage.getItem(GUEST_DATA_VERSION_KEY) === GUEST_DATA_VERSION) return "none"
  let hasLegacyMark = false
  for (let i = 0; i < storage.length; i++) {
    if (storage.key(i)?.startsWith(`${MERGE_COMPLETED_KEY}-`)) {
      hasLegacyMark = true
      break
    }
  }
  if (hasLegacyMark) {
    await clearGuestData()
  }
  storage.setItem(GUEST_DATA_VERSION_KEY, GUEST_DATA_VERSION)
  return hasLegacyMark ? "cleared" : "none"
}

let migration: Promise<boolean> | null = null

/**
 * 移行が終わるのを待つ（1 回のページの読み込みで 1 回だけ実行する）。成功したら true。
 * merge の判定・ゲストに戻ったときの印の削除・ログアウトの前に呼ぶ（以前の印を消す前に、移行の判定に使うため）。
 * 失敗したら false を返す。呼び出し側は以前の印を消さないこと（次の読み込みで移行をやり直すため。
 * 印を消すと、次は移行が必要と分からず、古いゲストのデータが次のログインで送られてしまう）
 */
export function ensureGuestDataMigrated(): Promise<boolean> {
  migration ??= migrateLegacyGuestData().then(
    () => true,
    (error) => {
      // バージョンのキーは付いていないので、次の呼び出しでやり直す
      console.error("[guestData] 移行に失敗:", error)
      migration = null
      return false
    }
  )
  return migration
}
