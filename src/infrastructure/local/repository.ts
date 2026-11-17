import type { ShoppingMemosDB } from "@/lib/db"
import type { SyncPushEntity } from "@/shared/schemas/sync"
import type { Clock } from "./clock"
import { enqueue } from "./syncQueue"

/**
 * ローカルのリポジトリの土台（offline-support.md「リポジトリ層」。#62 O6）
 *
 * エンティティの書き込みと同期キューへの記録を、1 つのトランザクションで行う（どちらかが失敗したら両方戻る）。
 * updatedAt は補正済みの時刻にする。ゲストではキューに積まない。
 * エンティティごとのリポジトリ（itemRepository など）は O7 / O8 でこの上に作る
 */

export type LocalTableName = "items" | "tags" | "lists" | "listItems"

const ENTITY_OF: Record<LocalTableName, SyncPushEntity> = {
  items: "item",
  tags: "tag",
  lists: "list",
  listItems: "listItem",
}

export interface LocalStore {
  db: ShoppingMemosDB
  clock: Clock
  /** 同期キューに積むか（ログイン中だけ true） */
  queue: boolean
}

type Row = { id: string; updatedAt?: Date }

function table(store: LocalStore, name: LocalTableName) {
  return store.db.table<Row, string>(name)
}

/** 作成する。patch は sync.push の作成のパッチ（API のフィールド名・JSON の値） */
export async function createRecord<T extends Row>(
  store: LocalStore,
  name: LocalTableName,
  record: Omit<T, "updatedAt">,
  patch: Record<string, unknown>
): Promise<T> {
  const now = store.clock.now()
  const row = { ...record, updatedAt: now } as T
  await store.db.transaction("rw", [table(store, name), store.db.syncQueue], async () => {
    await table(store, name).add(row)
    if (store.queue) {
      await enqueue(store.db, { entity: ENTITY_OF[name], entityId: row.id, type: "create", patch, clientTime: now.toISOString() })
    }
  })
  return row
}

/** 更新する。changes はローカルの値、patch は sync.push の更新のパッチ（変えたフィールドだけ） */
export async function updateRecord<T extends Row>(
  store: LocalStore,
  name: LocalTableName,
  id: string,
  changes: Partial<Omit<T, "id" | "updatedAt">>,
  patch: Record<string, unknown>
): Promise<void> {
  const now = store.clock.now()
  const clientTime = now.toISOString()
  await store.db.transaction("rw", [table(store, name), store.db.syncQueue], async () => {
    const updated = await table(store, name).update(id, { ...changes, updatedAt: now })
    if (updated === 0) throw new Error(`${name} に ${id} がありません`)
    if (store.queue) {
      const fieldTimes = Object.fromEntries(Object.keys(patch).map((key) => [key, clientTime]))
      await enqueue(store.db, { entity: ENTITY_OF[name], entityId: id, type: "update", patch, fieldTimes, clientTime })
    }
  })
}

/** 削除する（ローカルからは消す。サーバーでは論理削除になる） */
export async function deleteRecord(store: LocalStore, name: LocalTableName, id: string): Promise<void> {
  const clientTime = store.clock.now().toISOString()
  await store.db.transaction("rw", [table(store, name), store.db.syncQueue], async () => {
    await table(store, name).delete(id)
    if (store.queue) {
      await enqueue(store.db, { entity: ENTITY_OF[name], entityId: id, type: "delete", clientTime })
    }
  })
}
