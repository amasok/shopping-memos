import { and, eq, isNotNull, type SQL } from "drizzle-orm"
import { items, shoppingLists } from "@/infrastructure/db/drizzle/schema"
import { scopeCondition, type DbExecutor, type OwnerScope } from "@/infrastructure/db/ownership"

// 所有スコープの型と判定は src/infrastructure/db/ownership.ts に 1 つだけ置く（#101）
export type { DbExecutor } from "@/infrastructure/db/ownership"

/** リストの所有スコープ（共通の OwnerScope と同じ） */
export type ListScope = OwnerScope

/**
 * リストと同じスコープのカタログアイテムに限定する WHERE 条件
 *
 * リスト内アイテム（スナップショット）からカタログアイテムを名前で引く処理は、
 * 必ずこの条件を付けて他ユーザー・他グループのアイテムを対象外にすること。
 * スコープが特定できない場合（所有者なしの個人リスト）は何にも一致しない。
 */
export function catalogItemScopeCondition(scope: ListScope): SQL {
  return scopeCondition(items, scope)
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
    .where(eq(shoppingLists.id, listId))
  return row ?? null
}

/**
 * スコープ内の同名カタログアイテムを購入済みにする
 * @returns 更新したカタログアイテムID
 */
export async function markScopedItemsPurchasedByName(
  executor: DbExecutor,
  scope: ListScope,
  name: string,
  now: Date
): Promise<string[]> {
  const rows = await executor
    .update(items)
    .set({ purchasedAt: now, updatedAt: now })
    .where(and(eq(items.name, name), catalogItemScopeCondition(scope)))
    .returning({ id: items.id })
  return rows.map((r) => r.id)
}

/**
 * スコープ内の購入済みの同名カタログアイテムを未購入に戻す
 * @returns 更新したカタログアイテムID
 */
export async function markScopedItemsUnpurchasedByName(
  executor: DbExecutor,
  scope: ListScope,
  name: string
): Promise<string[]> {
  const rows = await executor
    .update(items)
    .set({ purchasedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(items.name, name),
        isNotNull(items.purchasedAt),
        catalogItemScopeCondition(scope)
      )
    )
    .returning({ id: items.id })
  return rows.map((r) => r.id)
}

/**
 * スコープ内の同名カタログアイテムを削除する
 * @returns 削除したカタログアイテムID
 */
export async function deleteScopedItemsByName(
  executor: DbExecutor,
  scope: ListScope,
  name: string
): Promise<string[]> {
  // itemTags は onDelete: cascade なので自動削除
  const rows = await executor
    .delete(items)
    .where(and(eq(items.name, name), catalogItemScopeCondition(scope)))
    .returning({ id: items.id })
  return rows.map((r) => r.id)
}
