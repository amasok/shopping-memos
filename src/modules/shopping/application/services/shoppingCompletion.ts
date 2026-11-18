import { and, eq, inArray } from "drizzle-orm"
import { listItems, shoppingLists } from "@/infrastructure/db/drizzle/schema"
import { accessibleByUser, type DbExecutor } from "@/infrastructure/db/ownership"
import { notDeleted, softDeleteValues, touchFields } from "@/infrastructure/db/syncColumns"
import type { FinishEntry, FinishShoppingPlan } from "../../domain/services/finishShopping"
import type { RevertHistoryPlan } from "../../domain/services/revertHistory"
import { LIST_STATE_FIELDS, type ListStateValues } from "../../domain/services/listState"
import {
  selectItemsToDeleteWithList,
  selectItemsToPurchase,
  selectItemsToUnpurchase,
} from "../../domain/services/catalogMatch"
import { uniqueNames } from "../../domain/services/listState"
import {
  deleteUnpurchasedItems,
  findScopedCandidatesByNames,
  markItemsPurchased,
  markItemsUnpurchased,
  type ListScope,
} from "./catalogItemScope"

/**
 * 買い物の完了・履歴の取り消しの I/O の手順（#179。design.md D3）
 *
 * tRPC（ShoppingService）と sync.push（SyncPushService）の両方がここを通り、規則は domain の純粋関数
 * （planFinishShopping・planRevertHistory・catalogMatch）に任せる。どれもトランザクションの中で呼ぶ
 */

/** 完了・取り消しの対象のリスト（ロック済みの行） */
export interface LockedList {
  id: string
  userId: string | null
  groupId: string | null
  status: string
  purchasedAt: Date | null
}

/** 書き込みの選択肢 */
export interface CompletionWriteOptions {
  /** sync.push の操作の時刻（UTC・ミリ秒の ISO）。渡すと、フィールドの時刻をこの時刻にし、カタログは LWW で書く */
  opTime?: string
  /** tRPC の操作をしたユーザー。渡すと、リストの更新を、このユーザーが使えるリストに限る（#73-1） */
  actorUserId?: string
}

type OkPlan<P> = Extract<P, { ok: true }>

/**
 * 操作したユーザーが使える、論理削除されていないリストを、行をロックして読む（tRPC 用。#73-1）
 * アクセスの確認（canAccess）の後に削除されたり、グループから外れたりしていれば null
 */
export async function lockAccessibleList(
  tx: DbExecutor,
  listId: string,
  actorUserId: string
): Promise<LockedList | null> {
  const [row] = await tx
    .select({
      id: shoppingLists.id,
      userId: shoppingLists.userId,
      groupId: shoppingLists.groupId,
      status: shoppingLists.status,
      purchasedAt: shoppingLists.purchasedAt,
    })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), notDeleted(shoppingLists), accessibleByUser(shoppingLists, actorUserId)))
    .for("update")
  return row ?? null
}

/** リストの、リストから外していない商品を読む（リストの行をロックしてから呼ぶ） */
export async function readListEntries(tx: DbExecutor, listId: string): Promise<FinishEntry[]> {
  return tx
    .select({ id: listItems.id, name: listItems.name, checked: listItems.checked })
    .from(listItems)
    .where(and(eq(listItems.listId, listId), notDeleted(listItems)))
}

const scopeOf = (list: LockedList): ListScope => ({ userId: list.userId, groupId: list.groupId })

/**
 * リストの状態を書く。fieldModifiedAt の状態のキーは、操作の時刻（なければサーバー時刻）にする
 * @returns 更新した行（使えないリスト・削除済みのリストなら undefined）
 */
async function writeListState(
  tx: DbExecutor,
  listId: string,
  state: ListStateValues,
  options: CompletionWriteOptions
) {
  const [row] = await tx
    .update(shoppingLists)
    .set({ ...state, ...touchFields(shoppingLists, LIST_STATE_FIELDS, options.opTime) })
    .where(
      and(
        eq(shoppingLists.id, listId),
        notDeleted(shoppingLists),
        options.actorUserId ? accessibleByUser(shoppingLists, options.actorUserId) : undefined
      )
    )
    .returning()
  return row
}

/**
 * 買い物の完了の計画を適用する
 * - チェック済みの商品と同じ名前・同じスコープのカタログの商品を購入済みにする（sync.push は LWW）
 * - 未チェックの商品を論理削除する
 * - リストを完了にする
 * @returns 実際に購入済みにしたカタログの商品の ID と、リストを更新できたか
 */
export async function applyFinishPlan(
  tx: DbExecutor,
  list: LockedList,
  plan: OkPlan<FinishShoppingPlan>,
  options: CompletionWriteOptions = {}
): Promise<{ purchasedItemIds: string[]; listUpdated: boolean }> {
  const scope = scopeOf(list)
  const at = plan.listState.purchasedAt as Date
  const candidates = await findScopedCandidatesByNames(tx, scope, plan.purchaseNames)
  const ids = selectItemsToPurchase(plan.purchaseNames, candidates, scope)
  const purchasedItemIds = await markItemsPurchased(tx, scope, ids, at, options.opTime)

  if (plan.removeEntryIds.length > 0) {
    await tx
      .update(listItems)
      .set(softDeleteValues())
      .where(and(inArray(listItems.id, plan.removeEntryIds), eq(listItems.listId, list.id), notDeleted(listItems)))
  }

  const row = await writeListState(tx, list.id, plan.listState, options)
  return { purchasedItemIds, listUpdated: row !== undefined }
}

/**
 * 履歴の取り消しの計画を適用する
 * - リストの商品と同じ名前・同じスコープの購入済みのカタログの商品を未購入に戻す（sync.push は LWW）
 * - リストを進行中に戻す
 * @returns 実際に未購入に戻したカタログの商品の ID と、更新したリストの行（更新できなければ undefined）
 */
export async function applyRevertPlan(
  tx: DbExecutor,
  list: LockedList,
  plan: OkPlan<RevertHistoryPlan>,
  options: CompletionWriteOptions = {}
) {
  const scope = scopeOf(list)
  const candidates = await findScopedCandidatesByNames(tx, scope, plan.revertNames)
  const ids = selectItemsToUnpurchase(plan.revertNames, candidates, scope)
  const revertedItemIds = await markItemsUnpurchased(tx, scope, ids, options.opTime)
  const listRow = await writeListState(tx, list.id, plan.listState, options)
  return { revertedItemIds, listRow }
}

/**
 * リストと一緒に消すカタログの商品を消す（179b「リストと同じ名前の未購入の商品も消すリストの削除」）
 * リストの行をロックしてからリストの商品を読み、同じ名前・同じスコープの未購入の商品を論理削除する。
 * リストの削除と同じトランザクションの中で呼ぶ
 * @returns 削除したカタログの商品の ID（使えないリスト・削除済みのリストなら何もせず空）
 */
export async function deleteCatalogItemsWithList(
  tx: DbExecutor,
  listId: string,
  actorUserId: string
): Promise<string[]> {
  const list = await lockAccessibleList(tx, listId, actorUserId)
  if (!list) return []
  const names = uniqueNames(await readListEntries(tx, listId))
  const scope = scopeOf(list)
  const candidates = await findScopedCandidatesByNames(tx, scope, names)
  return deleteUnpurchasedItems(tx, scope, selectItemsToDeleteWithList(names, candidates, scope))
}
