import { eq, sql } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  items,
  itemTags,
  listItems,
  shoppingLists,
  syncOperations,
  tags,
} from "@/infrastructure/db/drizzle/schema"
import { canAccessScope, type DbExecutor } from "@/infrastructure/db/ownership"
import type { OwnerScope } from "@/shared/domain/ownerScope"
import {
  applyFinishPlan,
  applyRevertPlan,
  readListEntries,
  type LockedList,
} from "@/modules/shopping/application/services/shoppingCompletion"
import { planFinishShopping } from "@/modules/shopping/domain/services/finishShopping"
import { planRevertHistory } from "@/modules/shopping/domain/services/revertHistory"
import { LIST_STATE_FIELDS } from "@/modules/shopping/domain/services/listState"
import { RowNotFoundError } from "@/infrastructure/db/errors"
import type {
  SyncPushEntity,
  SyncPushOperation,
  SyncPushOutput,
  SyncPushResult,
} from "@/shared/schemas/sync"
import { areTagsInScope } from "@/modules/catalog/application/services/ownership"
import { itemRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"
import { tagRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"
import { shoppingListRepository } from "@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository"
import { ListStatus } from "@/modules/shopping/domain/value-objects/ListStatus"
import {
  CREATED_FIELDS,
  compoundPatchSchemas,
  createPatchSchemas,
  updatableFields,
  updatePatchSchemas,
  type ItemCreatePatch,
  type ListCreatePatch,
  type ListItemCreatePatch,
  type TagCreatePatch,
} from "../pushPatches"

/**
 * sync.push（#62 O4）: クライアントの操作を、実データに冪等に反映する
 *
 * docs/features/offline-support.md「### 2. 競合解決」「**`sync.push`（作り直し）**」のとおり:
 * - 操作は 1 件ずつのトランザクションで適用する（1 件が rejected でも、ほかは続ける）
 * - opId（sync_operations.id）で冪等にする。同じユーザーの処理済みの opId は duplicate
 * - update はフィールド単位の LWW。field_modified_at[f] より古いフィールドだけを捨てる（partial）。
 *   キーがないフィールドは常に適用する。updated_at は now()（LWW には使わない）
 * - 削除は常に勝つ。削除済み（tombstone）への create / update は conflict
 * - 使えない行（他人・所属外のグループ）は、ないのと同じに扱い rejected にする。serverRow は返さない（#69）
 * - 未来の操作時刻は serverTime に丸める
 *
 * DB のエラーなど予期しない失敗は、そのまま投げる（リクエスト全体が 500 になり、クライアントがまとめて再送する。
 * 適用済みの操作は再送で duplicate になる）
 */

type Row = Record<string, unknown> & {
  id: string
  userId: string | null
  groupId: string | null
  deletedAt: Date | null
  fieldModifiedAt: Record<string, string>
}

type Outcome = Omit<SyncPushResult, "opId">

/** ロック済みのリストの行を、完了・取り消しの手順に渡す形にする */
const lockedList = (row: Row): LockedList => ({
  id: row.id,
  userId: row.userId,
  groupId: row.groupId,
  status: String(row.status),
  purchasedAt: (row.purchasedAt as Date | null) ?? null,
})

const rejected = (reason: string): Outcome => ({ status: "rejected", reason })

const TABLES = {
  item: items,
  tag: tags,
  list: shoppingLists,
  listItem: listItems,
} as const

/** 操作の時刻を、サーバー時刻を上限にして ISO（UTC・ミリ秒）にする */
function clampTime(iso: string, serverMs: number): string {
  return new Date(Math.min(Date.parse(iso), serverMs)).toISOString()
}

/** 行を取り、ロックする（論理削除済みも含む） */
async function lockRow(tx: DbExecutor, entity: SyncPushEntity, id: string): Promise<Row | undefined> {
  const table = TABLES[entity]
  const [row] = await tx.select().from(table).where(eq(table.id, id)).for("update")
  return row as Row | undefined
}

type ParentList = { id: string; userId: string | null; groupId: string | null; status: string; deletedAt: Date | null }

/**
 * 親のリスト（論理削除済みも含む）を、共有ロックを取って読む。
 * リストのアイテムの作成・チェック・削除の間に、リストが削除・完了されないようにする
 * （ロックがないと、削除済み・完了済みのリストの下に、生きているリストのアイテムができる）
 */
async function lockParentList(tx: DbExecutor, listId: string): Promise<ParentList | undefined> {
  const [list] = await tx
    .select({
      id: shoppingLists.id,
      userId: shoppingLists.userId,
      groupId: shoppingLists.groupId,
      status: shoppingLists.status,
      deletedAt: shoppingLists.deletedAt,
    })
    .from(shoppingLists)
    .where(eq(shoppingLists.id, listId))
    .for("share")
  return list
}

/** 親のリスト（削除されていないもの。共有ロックを取る） */
async function findList(tx: DbExecutor, listId: string) {
  const list = await lockParentList(tx, listId)
  return list && !list.deletedAt ? list : undefined
}

/** クライアントに返す行（アイテムは tagIds を付ける） */
async function toServerRow(tx: DbExecutor, entity: SyncPushEntity, id: string): Promise<Record<string, unknown>> {
  const row = (await lockRow(tx, entity, id)) as Row
  if (entity !== "item") return row
  const links = await tx.select({ tagId: itemTags.tagId }).from(itemTags).where(eq(itemTags.itemId, id))
  return { ...row, tagIds: links.map((l) => l.tagId) }
}

/** DB の現在時刻（ミリ秒） */
async function dbNowMs(): Promise<number> {
  const [{ now }] = (await db.execute(sql`SELECT now() AS now`)) as unknown as [{ now: Date | string }]
  return new Date(now).getTime()
}

/** 処理済みの操作の記録から、最初の結果（"status" か "status:reason"）を取り出す */
function originalResult(payload: string): string | undefined {
  try {
    const { status, reason } = JSON.parse(payload) as { status?: string; reason?: string }
    if (!status) return undefined
    return reason ? `${status}:${reason}` : status
  } catch {
    return undefined
  }
}

export class SyncPushService {
  async push(userId: string, operations: SyncPushOperation[]): Promise<SyncPushOutput> {
    // 未来の時刻の丸めには、リクエストの開始時刻を使う
    const serverMs = await dbNowMs()
    const results: SyncPushResult[] = []
    for (const op of operations) {
      results.push({ opId: op.opId, ...(await this.applyOne(userId, op, serverMs)) })
    }
    // 返す serverTime は処理の後の時刻（クライアントは「serverTime − 受信時刻」で時計のずれを補正するため）
    return { serverTime: new Date(await dbNowMs()).toISOString(), results }
  }

  private applyOne(userId: string, op: SyncPushOperation, serverMs: number): Promise<Outcome> {
    return db.transaction(async (tx) => {
      // 長いトランザクションを作らない（pull のカーソルの 60 秒のさかのぼりの前提。設計書）
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`)

      // 冪等化: 先に操作を記録する。同じ opId が処理中なら、そのコミットを待ってから重複になる
      const [inserted] = await tx
        .insert(syncOperations)
        .values({
          id: op.opId,
          userId,
          entity: op.entity,
          entityId: op.entityId,
          operation: op.type,
          payload: JSON.stringify({ patch: op.patch, fieldTimes: op.fieldTimes, clientTime: op.clientTime }),
          syncedAt: new Date(serverMs),
        })
        .onConflictDoNothing({ target: syncOperations.id })
        .returning({ id: syncOperations.id })
      if (!inserted) {
        const [existing] = await tx
          .select({ userId: syncOperations.userId, payload: syncOperations.payload })
          .from(syncOperations)
          .where(eq(syncOperations.id, op.opId))
        if (existing?.userId !== userId) return rejected("op_conflict")
        // 最初に処理したときの結果を reason で返す（レスポンスが失われて再送したとき、
        // 拒否された操作を「適用済み」と取り違えないように。例: "applied" / "rejected:not_found"）
        return { status: "duplicate", reason: originalResult(existing.payload) }
      }

      let outcome: Outcome
      try {
        outcome = await this.apply(tx, userId, op, serverMs)
      } catch (error) {
        // リポジトリの「対象なし」（UPDATE が 0 行。DB のエラーではないのでトランザクションは続けられる）は、
        // 決まって失敗する操作なので rejected にする（500 にすると、再送でもキュー全体が止まり続ける）
        if (error instanceof RowNotFoundError) {
          outcome = rejected("not_found")
        } else {
          throw error
        }
      }

      // 結果を記録する（rejected / conflict の件数を後から数えられるように）
      await tx
        .update(syncOperations)
        .set({
          payload: JSON.stringify({
            patch: op.patch,
            fieldTimes: op.fieldTimes,
            clientTime: op.clientTime,
            status: outcome.status,
            reason: outcome.reason,
          }),
        })
        .where(eq(syncOperations.id, op.opId))
      return outcome
    })
  }

  private async apply(tx: DbExecutor, userId: string, op: SyncPushOperation, serverMs: number): Promise<Outcome> {
    // リストのアイテムは親のリストで判定する。親が削除済みなら、アイテムも削除済みと同じに扱う。
    // ロックは「親のリスト → リストのアイテム」の順に取る（リストの削除・完了と同じ順。逆だとデッドロックになる）。
    // そのため、親のリストの ID だけを先にロックなしで読む（list_id は変わらない）
    let parent: ParentList | undefined
    if (op.entity === "listItem") {
      const [ref] = await tx
        .select({ listId: listItems.listId })
        .from(listItems)
        .where(eq(listItems.id, op.entityId))
      parent = ref ? await lockParentList(tx, ref.listId) : undefined
    }
    const row = await lockRow(tx, op.entity, op.entityId)
    const scope: OwnerScope | null = !row ? null : op.entity === "listItem" ? (parent ?? null) : row
    // 使えない行は、ないのと同じに扱う（存在の有無を漏らさない）
    const usable = scope !== null && (await canAccessScope(tx, scope, userId))
    const deleted = !!row && (row.deletedAt !== null || (op.entity === "listItem" && (!parent || parent.deletedAt !== null)))

    switch (op.type) {
      case "create": {
        const parsed = createPatchSchemas[op.entity].safeParse(op.patch ?? {})
        if (!parsed.success) return rejected("invalid_patch")
        if (row) {
          if (!usable) return rejected("id_conflict")
          // 同じ ID の行があれば、フィールド単位の更新として扱う（作成の再送など）
          const fields = updatableFields(op.entity)
          const patch = Object.fromEntries(Object.entries(op.patch ?? {}).filter(([k]) => fields.includes(k)))
          return this.update(tx, userId, { ...op, patch }, row, deleted, serverMs)
        }
        return this.create(tx, userId, op, parsed.data, clampTime(op.clientTime, serverMs), serverMs)
      }
      case "update": {
        if (!row || !usable) return rejected("not_found")
        return this.update(tx, userId, op, row, deleted, serverMs)
      }
      case "delete": {
        if (!row || !usable) return rejected("not_found")
        if (deleted) return { status: "applied" }
        return this.delete(tx, userId, op.entity, row)
      }
      case "finishShopping":
      case "revertHistory": {
        if (op.entity !== "list") return rejected("invalid_patch")
        const parsed = compoundPatchSchemas[op.type].safeParse(op.patch ?? {})
        if (!parsed.success) return rejected("invalid_patch")
        if (!row || !usable) return rejected("not_found")
        if (deleted) {
          return { status: "conflict", reason: "deleted", serverRow: await toServerRow(tx, "list", row.id) }
        }
        const opTime = clampTime(op.clientTime, serverMs)
        return op.type === "finishShopping"
          ? this.finishShopping(tx, row, parsed.data as { location?: string | null }, opTime)
          : this.revertHistory(tx, row, opTime)
      }
    }
  }

  /**
   * 複合操作の前提の確認: リストの状態のフィールドが、操作の時刻より新しく書き換えられていれば適用しない
   * （後から届いた古い完了・取り消しで、新しい状態を上書きしない）
   */
  private async staleListState(tx: DbExecutor, row: Row, opTime: string): Promise<Outcome | null> {
    const newer = LIST_STATE_FIELDS.some((f) => {
      const current = row.fieldModifiedAt?.[f]
      return current !== undefined && Date.parse(current) > Date.parse(opTime)
    })
    return newer ? { status: "conflict", reason: "stale", serverRow: await toServerRow(tx, "list", row.id) } : null
  }

  /**
   * 買い物の完了（#62 O4b・#179）。tRPC の finishShopping（ShoppingService）と同じ規則（domain の planFinishShopping）と
   * 手順（shoppingCompletion の applyFinishPlan）を、1 トランザクションで操作の時刻で適用する
   * - 進行中でなければ conflict（already_completed）。リストの状態が操作の時刻より新しければ conflict（stale）
   * - チェック済みのアイテムと同名の、リストと同じスコープのカタログのアイテムを購入済みにする（purchasedAt が新しいものは変えない）
   * - 未チェックのリストのアイテムは論理削除する（カタログのアイテムに戻る）
   * - リストを完了にする（status / completedAt / purchasedAt / location の時刻は操作の時刻）
   */
  private async finishShopping(
    tx: DbExecutor,
    row: Row,
    patch: { location?: string | null },
    opTime: string
  ): Promise<Outcome> {
    const entries = await readListEntries(tx, row.id)
    const plan = planFinishShopping({ status: String(row.status), entries, at: new Date(opTime), location: patch.location })
    if (!plan.ok) {
      return { status: "conflict", reason: "already_completed", serverRow: await toServerRow(tx, "list", row.id) }
    }
    const stale = await this.staleListState(tx, row, opTime)
    if (stale) return stale

    await applyFinishPlan(tx, lockedList(row), plan, { opTime })
    return { status: "applied" }
  }

  /**
   * 履歴の取り消し（#62 O4b・#179）。tRPC の revertHistory（ShoppingService）と同じ規則（planRevertHistory）と
   * 手順（applyRevertPlan）を、1 トランザクションで操作の時刻で適用する
   * - 購入日時がなければ conflict（not_completed）。リストの状態が操作の時刻より新しければ conflict（stale）
   * - リストのアイテムと同名の、購入済みのカタログのアイテムを未購入に戻す（purchasedAt が新しいものは変えない）
   * - リストを進行中に戻す
   */
  private async revertHistory(tx: DbExecutor, row: Row, opTime: string): Promise<Outcome> {
    const entries = await readListEntries(tx, row.id)
    const plan = planRevertHistory({ purchasedAt: row.purchasedAt as Date | null, entries })
    if (!plan.ok) {
      return { status: "conflict", reason: "not_completed", serverRow: await toServerRow(tx, "list", row.id) }
    }
    const stale = await this.staleListState(tx, row, opTime)
    if (stale) return stale

    await applyRevertPlan(tx, lockedList(row), plan, { opTime })
    return { status: "applied" }
  }

  private async create(
    tx: DbExecutor,
    userId: string,
    op: SyncPushOperation,
    patch: unknown,
    opTime: string,
    serverMs: number
  ): Promise<Outcome> {
    const times = Object.fromEntries(CREATED_FIELDS[op.entity].map((f) => [f, opTime]))
    const id = op.entityId

    if (op.entity === "listItem") {
      const p = patch as ListItemCreatePatch
      const list = await findList(tx, p.listId)
      if (!list || !(await canAccessScope(tx, list, userId))) return rejected("invalid_reference")
      if (list.status !== ListStatus.IN_PROGRESS) return rejected("list_completed")
      if (!(await areTagsInScope(p.tagIds, list, { executor: tx }))) return rejected("invalid_reference")
      await tx.insert(listItems).values({
        id,
        listId: p.listId,
        name: p.name,
        quantity: p.quantity,
        memo: p.memo ?? null,
        tagIds: p.tagIds,
        checked: p.checked,
        userId,
        // リストのアイテムのグループはリストのもの（#68）
        groupId: list.groupId,
        fieldModifiedAt: times,
      })
      return { status: "applied" }
    }

    const { groupId = null } = patch as { groupId?: string | null }
    const scope = { userId, groupId }
    if (groupId && !(await canAccessScope(tx, scope, userId))) return rejected("forbidden")

    switch (op.entity) {
      case "item": {
        const p = patch as ItemCreatePatch
        if (!(await areTagsInScope(p.tagIds, scope, { executor: tx }))) return rejected("invalid_reference")
        await tx.insert(items).values({
          id,
          name: p.name,
          quantity: p.quantity,
          memo: p.memo ?? null,
          purchasedAt: p.purchasedAt ? new Date(clampTime(p.purchasedAt, serverMs)) : null,
          userId,
          groupId,
          fieldModifiedAt: times,
        })
        if (p.tagIds.length > 0) {
          await tx.insert(itemTags).values(p.tagIds.map((tagId) => ({ itemId: id, tagId })))
        }
        return { status: "applied" }
      }
      case "tag": {
        const p = patch as TagCreatePatch
        await tx.insert(tags).values({ id, name: p.name, userId, groupId, fieldModifiedAt: times })
        return { status: "applied" }
      }
      case "list": {
        const p = patch as ListCreatePatch
        await tx.insert(shoppingLists).values({
          id,
          name: p.name,
          status: ListStatus.IN_PROGRESS,
          userId,
          groupId,
          fieldModifiedAt: times,
        })
        return { status: "applied" }
      }
    }
  }

  private async update(
    tx: DbExecutor,
    userId: string,
    op: SyncPushOperation,
    row: Row,
    deleted: boolean,
    serverMs: number
  ): Promise<Outcome> {
    // 削除済み（リストのアイテムは親のリストの削除も）への更新は適用しない（削除が勝つ）。クライアントはローカルの行を消す
    if (deleted) {
      return { status: "conflict", reason: "deleted", serverRow: await toServerRow(tx, op.entity, row.id) }
    }
    const parsed = updatePatchSchemas[op.entity].safeParse(op.patch ?? {})
    if (!parsed.success) return rejected("invalid_patch")
    const patch = parsed.data as Record<string, unknown>

    if (op.entity === "listItem") {
      const list = await findList(tx, row.listId as string)
      if (list && list.status !== ListStatus.IN_PROGRESS) return rejected("list_completed")
    }
    if (op.entity === "item" && patch.tagIds !== undefined) {
      if (!(await areTagsInScope(patch.tagIds as string[], row, { executor: tx }))) {
        return rejected("invalid_reference")
      }
    }

    // フィールド単位の LWW: 操作時刻 >= そのフィールドの時刻なら適用する（キーがなければ常に適用）
    const applied: Record<string, unknown> = {}
    const appliedTimes: Record<string, string> = {}
    let discarded = 0
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue
      const time = clampTime(op.fieldTimes?.[field] ?? op.clientTime, serverMs)
      const current = row.fieldModifiedAt?.[field]
      if (current && Date.parse(time) < Date.parse(current)) {
        discarded++
        continue
      }
      applied[field] = value
      appliedTimes[field] = time
    }

    if (Object.keys(applied).length > 0) {
      const { tagIds, purchasedAt, ...columns } = applied
      const table = TABLES[op.entity]
      await tx
        .update(table)
        .set({
          ...columns,
          // 購入日時も、未来ならサーバー時刻に丸める
          ...(purchasedAt !== undefined
            ? { purchasedAt: typeof purchasedAt === "string" ? new Date(clampTime(purchasedAt, serverMs)) : null }
            : {}),
          fieldModifiedAt: { ...row.fieldModifiedAt, ...appliedTimes },
          updatedAt: sql`now()`,
        })
        .where(eq(table.id, row.id))
      if (op.entity === "item" && tagIds !== undefined) {
        await tx.delete(itemTags).where(eq(itemTags.itemId, row.id))
        const ids = tagIds as string[]
        if (ids.length > 0) {
          await tx.insert(itemTags).values(ids.map((tagId) => ({ itemId: row.id, tagId })))
        }
      }
    }

    if (discarded > 0) {
      return { status: "partial", serverRow: await toServerRow(tx, op.entity, row.id) }
    }
    return { status: "applied" }
  }

  private async delete(tx: DbExecutor, userId: string, entity: SyncPushEntity, row: Row): Promise<Outcome> {
    switch (entity) {
      case "item":
        await itemRepository.delete(row.id, userId, tx)
        break
      case "tag":
        await tagRepository.delete(row.id, userId, tx)
        break
      case "list":
        await shoppingListRepository.delete(row.id, userId, tx)
        break
      case "listItem": {
        const list = await findList(tx, row.listId as string)
        if (list && list.status !== ListStatus.IN_PROGRESS) return rejected("list_completed")
        await shoppingListRepository.removeItem(row.id, userId, tx)
        break
      }
    }
    return { status: "applied" }
  }
}

export const syncPushService = new SyncPushService()
