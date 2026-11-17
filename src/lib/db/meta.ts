import type { ShoppingMemosDB } from "./index"

/** ユーザー DB の meta テーブルの値（offline-support.md「ユーザー DB の meta テーブル」） */
export interface MetaValues {
  /** sync.pull の次のカーソル */
  cursor: string
  /** サーバーの時刻 - 端末の時刻（ミリ秒） */
  serverTimeOffset: number
  /** 最後に同期した時刻（ISO） */
  lastSyncAt: string
  /** 前回の pull の所属グループの一覧 */
  groupIds: string[]
}

export type MetaKey = keyof MetaValues

export async function getMeta<K extends MetaKey>(database: ShoppingMemosDB, key: K): Promise<MetaValues[K] | undefined> {
  const record = await database.meta.get(key)
  return record?.value as MetaValues[K] | undefined
}

export async function setMeta<K extends MetaKey>(database: ShoppingMemosDB, key: K, value: MetaValues[K]): Promise<void> {
  await database.meta.put({ key, value })
}

export async function deleteMeta(database: ShoppingMemosDB, key: MetaKey): Promise<void> {
  await database.meta.delete(key)
}
