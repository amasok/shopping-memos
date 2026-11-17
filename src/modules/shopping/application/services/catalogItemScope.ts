import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm"
import { items, itemTags, shoppingLists } from "@/infrastructure/db/drizzle/schema"
import { scopeCondition, type DbExecutor, type OwnerScope } from "@/infrastructure/db/ownership"
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

/**
 * スコープ内の同名カタログアイテムを購入済みにする
 * @param opTime sync.push の複合操作の時刻（UTC・ミリ秒の ISO。#62 O4b）。渡すと、purchasedAt の時刻がそれより新しい
 *   アイテムは変えず（フィールド単位の LWW）、purchasedAt のキーをその時刻にする
 * @returns 更新したカタログアイテムID
 */
export async function markScopedItemsPurchasedByName(
  executor: DbExecutor,
  scope: ListScope,
  name: string,
  now: Date,
  opTime?: string
): Promise<string[]> {
  const rows = await executor
    .update(items)
    .set({ purchasedAt: now, ...touchFields(items, ["purchasedAt"], opTime) })
    .where(
      and(
        eq(items.name, name),
        catalogItemScopeCondition(scope),
        opTime ? fieldNotNewerThan(items, "purchasedAt", opTime) : undefined
      )
    )
    .returning({ id: items.id })
  return rows.map((r) => r.id)
}

/**
 * スコープ内の購入済みの同名カタログアイテムを未購入に戻す
 * @param opTime sync.push の複合操作の時刻（markScopedItemsPurchasedByName と同じ。#62 O4b）
 * @returns 更新したカタログアイテムID
 */
export async function markScopedItemsUnpurchasedByName(
  executor: DbExecutor,
  scope: ListScope,
  name: string,
  opTime?: string
): Promise<string[]> {
  const rows = await executor
    .update(items)
    .set({ purchasedAt: null, ...touchFields(items, ["purchasedAt"], opTime) })
    .where(
      and(
        eq(items.name, name),
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
