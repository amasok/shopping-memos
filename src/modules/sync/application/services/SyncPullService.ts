import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  groupMembers,
  items,
  itemTags,
  listItems,
  shoppingLists,
  tags,
} from "@/infrastructure/db/drizzle/schema"
import { ownedOrInGroups, type DbExecutor } from "@/infrastructure/db/ownership"
import { z } from "@/shared/schemas/z"
import type { SyncPullEntity, SyncPullOutput } from "@/shared/schemas/sync"

/**
 * sync.pull（#62 O5）: 前回からの差分を、カーソルで少しずつ返す
 *
 * docs/features/offline-support.md「**`sync.pull`（作り直し）**」のとおり:
 * - 対象は、自分の個人データと所属グループのデータ（リストのアイテムは親のリストで判定）。tombstone（deleted_at）も返す
 * - カーソルはエンティティごとの (updated_at, id)。1 回 500 行まで
 * - 取りこぼし対策: pull の始め（そのエンティティの最初のページ）だけ、カーソルの時刻から 60 秒さかのぼる。
 *   2 ページ目からは (updated_at, id) > (t, id) で続きを取る（ページごとにさかのぼると、同じページを取り続けることがある）
 * - 時刻はマイクロ秒まで DB の文字列のまま持つ（JS の Date にするとミリ秒に丸まり、境界の行を取りこぼす・取り続ける）
 */

export const PULL_PAGE_SIZE = 500

/**
 * カーソルの時刻の形。DateStyle の設定に左右されないよう to_char で固定する（::text はセッションの設定で形が変わる）
 */
const AT_FORMAT = "YYYY-MM-DD HH24:MI:SS.US"
const AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.\d{6}$/

/** 形は合っていても、時刻として正しいか（2026-13-45 などを ::timestamp で DB のエラーにしない） */
function isValidTimestamp(value: string): boolean {
  const m = AT_PATTERN.exec(value)
  if (!m) return false
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  )
}
const ENTITIES = ["tags", "items", "lists", "listItems"] as const satisfies readonly SyncPullEntity[]

/** カーソルの不正（形が壊れている・改ざん）。ルーターで BAD_REQUEST にする */
export class InvalidCursorError extends Error {
  constructor() {
    super("カーソルが不正です")
    this.name = "InvalidCursorError"
  }
}

const positionSchema = z
  .object({
    /** 最後に返した行の updated_at（DB の文字列。マイクロ秒まで。AT_FORMAT の形） */
    at: z.string().regex(AT_PATTERN).refine(isValidTimestamp),
    id: z.string().max(100),
    /** この pull の中で、もう最初のページを取ったか（取ったら 60 秒さかのぼらない） */
    started: z.boolean(),
  })
  .nullable()

const cursorSchema = z.object({
  v: z.literal(1),
  pos: z.object({ tags: positionSchema, items: positionSchema, lists: positionSchema, listItems: positionSchema }),
})

type Cursor = z.infer<typeof cursorSchema>
type Position = z.infer<typeof positionSchema>

const EMPTY_CURSOR: Cursor = { v: 1, pos: { tags: null, items: null, lists: null, listItems: null } }

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function decodeCursor(value: string | undefined): Cursor {
  if (!value) return EMPTY_CURSOR
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
  } catch {
    throw new InvalidCursorError()
  }
}

type Table = typeof items | typeof tags | typeof shoppingLists | typeof listItems

/** カーソルより後の行の条件（最初のページは 60 秒さかのぼる） */
function afterPosition(table: Table, pos: Position): SQL | undefined {
  if (!pos) return undefined
  if (!pos.started) {
    return sql`${table.updatedAt} > ${pos.at}::timestamp - interval '60 seconds'`
  }
  // 行の比較だけだとインデックスの範囲にならないので、updated_at の下限も付ける
  return sql`${table.updatedAt} >= ${pos.at}::timestamp AND (${table.updatedAt}, ${table.id}) > (${pos.at}::timestamp, ${pos.id})`
}

type PageRow = { row: Record<string, unknown> & { id: string }; at: string }

/** カーソルに入れる updated_at の文字列（形を固定する） */
const atText = (table: Table) => sql<string>`to_char(${table.updatedAt}, ${AT_FORMAT})`

async function fetchPage(
  tx: DbExecutor,
  entity: SyncPullEntity,
  userId: string,
  groupIds: readonly string[],
  pos: Position,
  limit: number
): Promise<PageRow[]> {
  if (entity === "listItems") {
    // リストのアイテムは親のリストで判定する。親のリストが削除済みなら、tombstone として返す（O3b からの申し送り）
    const rows = await tx
      .select({ row: listItems, at: atText(listItems), parentDeletedAt: shoppingLists.deletedAt })
      .from(listItems)
      .innerJoin(shoppingLists, eq(listItems.listId, shoppingLists.id))
      // 親のリストで判定するので、list_items の (user_id|group_id, updated_at) のインデックスは使えない（件数が少ないうちは十分）
      .where(and(ownedOrInGroups(shoppingLists, userId, groupIds), afterPosition(listItems, pos)))
      .orderBy(asc(listItems.updatedAt), asc(listItems.id))
      .limit(limit)
    return rows.map(({ row, at, parentDeletedAt }) => ({
      row: { ...row, deletedAt: row.deletedAt ?? parentDeletedAt },
      at,
    }))
  }
  const table = { tags, items, lists: shoppingLists }[entity]
  const rows = await tx
    .select({ row: table, at: atText(table) })
    .from(table)
    .where(and(ownedOrInGroups(table, userId, groupIds), afterPosition(table, pos)))
    .orderBy(asc(table.updatedAt), asc(table.id))
    .limit(limit)
  return rows as PageRow[]
}

/** アイテムに tagIds を埋め込む（中間テーブルの削除は pull で伝わらないため。設計書） */
async function withTagIds(tx: DbExecutor, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows
  const links = await tx
    .select({ itemId: itemTags.itemId, tagId: itemTags.tagId })
    .from(itemTags)
    .where(inArray(itemTags.itemId, rows.map((r) => r.id as string)))
  const byItem = new Map<string, string[]>()
  for (const link of links) {
    byItem.set(link.itemId, [...(byItem.get(link.itemId) ?? []), link.tagId])
  }
  return rows.map((r) => ({ ...r, tagIds: byItem.get(r.id as string) ?? [] }))
}

export class SyncPullService {
  async pull(userId: string, cursorValue: string | undefined): Promise<SyncPullOutput> {
    const cursor = decodeCursor(cursorValue)
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`)
      // 所属グループを先に読み、同じトランザクションの中でスコープの条件に使う
      const memberships = await tx
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(eq(groupMembers.userId, userId))
      const groupIds = memberships.map((m) => m.groupId)

      const changes: SyncPullOutput["changes"] = { tags: [], items: [], lists: [], listItems: [] }
      const next: Cursor = { v: 1, pos: { ...cursor.pos } }
      let remaining = PULL_PAGE_SIZE
      let hasMore = false

      for (const entity of ENTITIES) {
        if (remaining === 0) {
          // このページには入らなかった。次のページで、このエンティティの最初のページとして取る
          hasMore = true
          break
        }
        const pos = cursor.pos[entity]
        const rows = await fetchPage(tx, entity, userId, groupIds, pos, remaining + 1)
        const page = rows.slice(0, remaining)
        if (rows.length > remaining) hasMore = true
        const last = page.at(-1)
        // 最初のページを取ったら、続きはさかのぼらずに取る（行がなくても、さかのぼって確かめ済み）
        next.pos[entity] = last ? { at: last.at, id: last.row.id, started: true } : pos && { ...pos, started: true }
        const pageRows = page.map((r) => r.row)
        changes[entity] = entity === "items" ? await withTagIds(tx, pageRows) : pageRows
        remaining -= page.length
      }

      if (!hasMore) {
        // 取り終えたら、次の pull は 60 秒さかのぼって始める
        for (const entity of ENTITIES) {
          const pos = next.pos[entity]
          next.pos[entity] = pos && { ...pos, started: false }
        }
      }

      const [{ now }] = (await tx.execute(sql`SELECT now() AS now`)) as unknown as [{ now: Date | string }]
      return {
        serverTime: new Date(now).toISOString(),
        changes,
        memberships: { groupIds },
        nextCursor: encodeCursor(next),
        hasMore,
      }
    })
  }
}

export const syncPullService = new SyncPullService()
