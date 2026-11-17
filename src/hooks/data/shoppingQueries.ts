import type { ListItem, ShoppingList, ShoppingMemosDB } from "@/lib/db"
import type { CatalogOrder } from "./catalogQueries"

/**
 * 端末の DB（ゲスト DB・ユーザー DB）から買い物の一覧を読む（#62 O8。openspec の shopping「端末の DB の買い物の一覧」）
 *
 * 並びは order で分ける（design.md D5）
 * - server: ローカルファースト。サーバーと同じく、リストとリストの商品は作成日時の古い順
 * - guest: ゲスト。今のまま並べ替えない（そろえるかは 62-o8b でユーザーに確認する）
 * 履歴はどちらも購入日時の新しい順
 */

/** 購入履歴（purchasedAtが入っているリスト）にlistItemsを付与した型 */
export interface PurchaseHistoryWithItems extends ShoppingList {
  listItems: ListItem[]
}

export interface ListQueryOptions {
  groupId: string | undefined
  status?: "in_progress" | "completed"
  includeCompleted?: boolean
  /** true なら groupId で絞らない */
  includeAllGroups?: boolean
  order: CatalogOrder
}

const byCreatedAt = <T extends { createdAt: Date }>(a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime()

export async function queryLists(db: ShoppingMemosDB, options: ListQueryOptions): Promise<ShoppingList[]> {
  const { groupId, status, includeCompleted = false, includeAllGroups = false, order } = options
  const lists = await db.lists
    .filter((list) => {
      if (!includeAllGroups && list.groupId !== groupId) return false
      if (status && list.status !== status) return false
      if (!includeCompleted && list.status === "completed") return false
      return true
    })
    .toArray()
  return order === "server" ? lists.sort(byCreatedAt) : lists
}

export async function queryListItems(db: ShoppingMemosDB, listIds: string[], order: CatalogOrder): Promise<ListItem[]> {
  if (listIds.length === 0) return []
  const items = await db.listItems.where("listId").anyOf(listIds).toArray()
  return order === "server" ? items.sort(byCreatedAt) : items
}

export async function queryHistory(
  db: ShoppingMemosDB,
  options: { groupId: string | undefined; limit?: number; offset?: number; order: CatalogOrder }
): Promise<PurchaseHistoryWithItems[]> {
  const lists = await db.lists.filter((list) => list.groupId === options.groupId && !!list.purchasedAt).toArray()
  lists.sort((a, b) => (b.purchasedAt?.getTime() ?? 0) - (a.purchasedAt?.getTime() ?? 0))
  let page = lists
  if (options.offset) page = page.slice(options.offset)
  if (options.limit) page = page.slice(0, options.limit)
  return Promise.all(
    page.map(async (list) => ({ ...list, listItems: await queryListItems(db, [list.id], options.order) }))
  )
}
