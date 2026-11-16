import { db, type ListItem, type PendingMergeRecord, type ShoppingItem, type ShoppingList, type Tag } from "./index"
import { DEFAULT_TAG_NAMES, initializeDefaultTags } from "./tags"

/**
 * ゲストのデータ（IndexedDB）とログインの関係（offline-support.md「ゲストのデータとログイン・ログアウト」）
 *
 * - ログインのたびに、ゲストのデータ（と、このアカウントで取り込めずに残したデータ）があれば sync.merge で送る
 * - 取り込めた分と取り込み済みの分は消し、取り込めなかったものだけを pendingMerge に、このアカウントの分として移す（#144）。
 *   pendingMerge はゲストの画面に出さず、そのアカウントの merge でだけ再送する
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

// === 取り込めなかったものだけを残す（#144） ===

/** pendingMerge に残せるエンティティ（履歴はリストの purchasedAt なので、リストとして残す） */
export type GuestEntity = PendingMergeRecord["entity"]
export const GUEST_ENTITIES: readonly GuestEntity[] = ["tags", "items", "lists", "listItems"]

export interface GuestDataForMerge {
  tags: Tag[]
  items: ShoppingItem[]
  lists: ShoppingList[]
  listItems: ListItem[]
}

const pendingKey = (userId: string, entity: GuestEntity, id: string) => `${userId}:${entity}:${id}`

/**
 * merge で送るゲストのデータを読む。通常のテーブル（まだどのアカウントにも送っていないデータ）と、
 * このアカウントの pendingMerge（前回取り込めずに残したデータ）を合わせる。ほかのアカウントの pendingMerge は含めない
 */
export async function loadGuestDataForMerge(userId: string): Promise<GuestDataForMerge> {
  const [tags, items, lists, listItems, pending] = await Promise.all([
    db.tags.toArray(),
    db.items.toArray(),
    db.lists.toArray(),
    db.listItems.toArray(),
    db.pendingMerge.where("userId").equals(userId).toArray(),
  ])
  const data: GuestDataForMerge = { tags, items, lists, listItems }
  for (const row of pending) {
    const target = data[row.entity] as Array<{ id: string }>
    // 同じ ID が通常のテーブルにもあれば、通常のテーブルのほう（新しい）を使う
    if (!target.some((r) => r.id === (row.record as { id: string }).id)) target.push(row.record as never)
  }
  return data
}

export interface MergeOutcome {
  /** 送ったレコードの ID（エンティティごと） */
  sent: Record<GuestEntity, string[]>
  /** そのうち、取り込めなかったので残すもの（エンティティごと）。sent の部分集合 */
  keep: Record<GuestEntity, string[]>
  /** 残すレコードの中身（エンティティごとに、ID → レコード） */
  records: GuestDataForMerge
}

/**
 * merge の結果をゲストの DB に反映する（1 つのトランザクション）
 * - 送ったレコードは、通常のテーブルと、このアカウントの pendingMerge から消す
 * - 取り込めなかったものは、このアカウントの pendingMerge に入れる（通常のテーブルからは消えるので、ゲストの画面に出ない）
 * - ほかのアカウントの pendingMerge には触れない
 * - 通常のタグのテーブルが空になったら、初期タグを作り直す
 */
export async function applyMergeOutcome(userId: string, outcome: MergeOutcome): Promise<void> {
  const now = new Date()
  await db.transaction("rw", [db.tags, db.items, db.lists, db.listItems, db.pendingMerge], async () => {
    for (const entity of GUEST_ENTITIES) {
      const table = db[entity] as unknown as { bulkDelete: (ids: string[]) => Promise<void> }
      const sent = outcome.sent[entity]
      await table.bulkDelete(sent)
      await db.pendingMerge.bulkDelete(sent.map((id) => pendingKey(userId, entity, id)))

      const keep = new Set(outcome.keep[entity])
      const rows = (outcome.records[entity] as Array<{ id: string }>)
        .filter((record) => keep.has(record.id))
        .map((record) => ({
          key: pendingKey(userId, entity, record.id),
          entity,
          userId,
          record: record as PendingMergeRecord["record"],
          createdAt: now,
        }))
      await db.pendingMerge.bulkPut(rows)
    }
  })
  await initializeDefaultTags()
}

/** 「破棄する」: このアカウントで取り込めずに残したデータを消す（ほかのアカウントの分は残す） */
export async function discardPendingMerge(userId: string): Promise<void> {
  await db.pendingMerge.where("userId").equals(userId).delete()
}

/** このアカウントで取り込めずに残したデータの件数 */
export async function countPendingMerge(userId: string): Promise<number> {
  return db.pendingMerge.where("userId").equals(userId).count()
}
