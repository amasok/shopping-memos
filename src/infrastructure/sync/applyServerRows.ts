import type { ShoppingMemosDB } from "@/lib/db"
import type { SyncPullEntity, SyncPushEntity } from "@/shared/schemas/sync"

/**
 * サーバーの行（sync.pull の changes・sync.push の serverRow）をユーザー DB に反映する（#62 O6）
 * - 未送信（pending / inflight）の操作があるエンティティは上書きしない（push が先、pull が後）
 * - tombstone（deletedAt あり）はローカルから消す。削除済みのリストは、その下のリストのアイテムもまとめて消す
 * - 重複して届いた行（60 秒のさかのぼり）は、同じ行を put するだけなので冪等
 */

export type ServerRow = Record<string, unknown>
export type ServerChanges = Record<SyncPullEntity, ServerRow[]>

export const TABLE_OF: Record<SyncPushEntity, SyncPullEntity> = {
  tag: "tags",
  item: "items",
  list: "lists",
  listItem: "listItems",
}

const FIELDS: Record<SyncPullEntity, readonly string[]> = {
  tags: ["id", "name", "groupId", "createdAt", "updatedAt"],
  items: ["id", "name", "quantity", "memo", "tagIds", "groupId", "purchasedAt", "createdAt", "updatedAt"],
  lists: ["id", "name", "status", "groupId", "createdAt", "completedAt", "purchasedAt", "location", "updatedAt"],
  listItems: ["id", "listId", "name", "quantity", "memo", "tagIds", "groupId", "checked", "createdAt", "updatedAt"],
}
const DATE_FIELDS = new Set(["createdAt", "updatedAt", "purchasedAt", "completedAt"])

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

/** サーバーの行をローカルの形にする（null は undefined に、日時は Date に。userId などローカルにない列は捨てる） */
export function toLocalRow(table: SyncPullEntity, row: ServerRow): ServerRow {
  const local: ServerRow = {}
  for (const field of FIELDS[table]) {
    const value = row[field]
    if (value === null || value === undefined) continue
    local[field] = DATE_FIELDS.has(field) ? toDate(value) : value
  }
  if (table === "items" || table === "listItems") local.tagIds ??= []
  return local
}

const isTombstone = (row: ServerRow) => row.deletedAt !== null && row.deletedAt !== undefined

/** 未送信の操作があるエンティティ（"<entity>:<id>"） */
async function unsentKeys(database: ShoppingMemosDB): Promise<Set<string>> {
  const ops = await database.syncQueue.where("status").anyOf("pending", "inflight").toArray()
  return new Set(ops.map((op) => `${TABLE_OF[op.entity]}:${op.entityId}`))
}

/** 反映する。呼び出し元のトランザクションの中でも外でも使える（外なら、ここで 1 つのトランザクションにする） */
export async function applyServerChanges(database: ShoppingMemosDB, changes: Partial<ServerChanges>): Promise<void> {
  const tables = [database.tags, database.items, database.lists, database.listItems, database.syncQueue]
  await database.transaction("rw", tables, async () => {
    const unsent = await unsentKeys(database)
    for (const table of ["tags", "items", "lists", "listItems"] as const) {
      const rows = (changes[table] ?? []).filter((row) => !unsent.has(`${table}:${String(row.id)}`))
      const deleted = rows.filter(isTombstone).map((row) => String(row.id))
      const alive = rows.filter((row) => !isTombstone(row)).map((row) => toLocalRow(table, row))
      if (alive.length > 0) await database.table(table).bulkPut(alive)
      if (deleted.length > 0) {
        await database.table(table).bulkDelete(deleted)
        if (table === "lists") await database.listItems.where("listId").anyOf(deleted).delete()
      }
    }
  })
}

/** 抜けたグループのローカルデータを消す */
export async function removeGroupData(database: ShoppingMemosDB, groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return
  const tables = [database.tags, database.items, database.lists, database.listItems]
  await database.transaction("rw", tables, async () => {
    for (const table of tables) await table.where("groupId").anyOf(groupIds).delete()
  })
}
