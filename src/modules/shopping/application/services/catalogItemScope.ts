import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm"
import { items, itemTags, shoppingLists } from "@/infrastructure/db/drizzle/schema"
import { scopeCondition, type DbExecutor } from "@/infrastructure/db/ownership"
import type { OwnerScope } from "@/shared/domain/ownerScope"
import { fieldNotNewerThan, notDeleted, softDeleteValues, touchFields } from "@/infrastructure/db/syncColumns"

// 所有スコープの型と判定は src/infrastructure/db/ownership.ts に 1 つだけ置く（#101）。
// ここからは再エクスポートしない（#151）

/** リストの所有スコープ（共通の OwnerScope と同じ） */
export type ListScope = OwnerScope

/**
 * リストと同じスコープのカタログアイテムに限定する WHERE 条件
 *
 * リスト内アイテム（スナップショット）からカタログアイテムを名前で引く処理は、
 * 必ずこの条件を付けて他ユーザー・他グループのアイテムを対象外にすること。
 * スコープが特定できない場合（所有者なしの個人リスト）は何にも一致しない。
 * 論理削除済みのアイテムは対象外（#62 O3b）
 */
export function catalogItemScopeCondition(scope: ListScope): SQL {
  return and(scopeCondition(items, scope), notDeleted(items)) as SQL
}

/**
 * リストの所有スコープを取得する
 */
export async function getListScope(
  executor: DbExecutor,
  listId: string
): Promise<ListScope | null> {
  const [row] = await executor
    .select({ userId: shoppingLists.userId, groupId: shoppingLists.groupId })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), notDeleted(shoppingLists)))
  return row ?? null
}

/** 照合の候補として読むカタログのアイテムの列（domain の CatalogCandidate） */
export interface ScopedCatalogCandidate {
  id: string
  name: string
  userId: string | null
  groupId: string | null
  purchasedAt: Date | null
  deletedAt: Date | null
}

/**
 * スコープ内の、名前が一致する、論理削除されていないカタログアイテムを読む（照合の候補。#179）
 * どれを書き換えるかは domain の照合（catalogMatch.ts）で選ぶ。ここの条件は読む量を絞るためで、
 * 書き込みの WHERE にも同じスコープの条件を付ける（markItemsPurchased など）
 */
export async function findScopedCandidatesByNames(
  executor: DbExecutor,
  scope: ListScope,
  names: readonly string[]
): Promise<ScopedCatalogCandidate[]> {
  if (names.length === 0) return []
  return executor
    .select({
      id: items.id,
      name: items.name,
      userId: items.userId,
      groupId: items.groupId,
      purchasedAt: items.purchasedAt,
      deletedAt: items.deletedAt,
    })
    .from(items)
    .where(and(inArray(items.name, [...names]), catalogItemScopeCondition(scope)))
}

/**
 * 選んだカタログアイテムを購入済みにする（#179）。スコープの外・論理削除済みのアイテムは、ID を渡しても変えない
 * @param opTime sync.push の複合操作の時刻（UTC・ミリ秒の ISO。#62 O4b）。渡すと、purchasedAt の時刻がそれより新しい
 *   アイテムは変えず（フィールド単位の LWW）、purchasedAt のキーをその時刻にする
 * @returns 実際に更新したカタログアイテムID
 */
export async function markItemsPurchased(
  executor: DbExecutor,
  scope: ListScope,
  ids: readonly string[],
  now: Date,
  opTime?: string
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await executor
    .update(items)
    .set({ purchasedAt: now, ...touchFields(items, ["purchasedAt"], opTime) })
    .where(
      and(
        inArray(items.id, [...ids]),
        catalogItemScopeCondition(scope),
        opTime ? fieldNotNewerThan(items, "purchasedAt", opTime) : undefined
      )
    )
    .returning({ id: items.id })
  return rows.map((r) => r.id)
}

/**
 * 選んだ購入済みのカタログアイテムを未購入に戻す（#179）。スコープの外・論理削除済み・未購入のアイテムは変えない
 * @param opTime sync.push の複合操作の時刻（markItemsPurchased と同じ。#62 O4b）
 * @returns 実際に更新したカタログアイテムID
 */
export async function markItemsUnpurchased(
  executor: DbExecutor,
  scope: ListScope,
  ids: readonly string[],
  opTime?: string
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await executor
    .update(items)
    .set({ purchasedAt: null, ...touchFields(items, ["purchasedAt"], opTime) })
    .where(
      and(
        inArray(items.id, [...ids]),
        isNotNull(items.purchasedAt),
        catalogItemScopeCondition(scope),
        opTime ? fieldNotNewerThan(items, "purchasedAt", opTime) : undefined
      )
    )
    .returning({ id: items.id })
  return rows.map((r) => r.id)
}

/**
 * スコープ内の同名カタログアイテムを論理削除する（タグの関連は消す。#62 O3b）
 * @returns 削除したカタログアイテムID
 */
export async function deleteScopedItemsByName(
  executor: DbExecutor,
  scope: ListScope,
  name: string
): Promise<string[]> {
  const rows = await executor
    .update(items)
    .set(softDeleteValues())
    .where(and(eq(items.name, name), catalogItemScopeCondition(scope)))
    .returning({ id: items.id })
  const ids = rows.map((r) => r.id)
  if (ids.length > 0) {
    await executor.delete(itemTags).where(inArray(itemTags.itemId, ids))
  }
  return ids
}
