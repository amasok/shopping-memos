import type { ListItem, ShoppingList, ShoppingMemosDB } from "@/lib/db"

/**
 * 端末の DB（ゲスト DB・ユーザー DB）から買い物の一覧を読む（#62 O8。openspec の shopping「端末の DB の買い物の一覧」）
 *
 * 並びは、ゲストもローカルファーストもサーバーと同じにする（62-o8b）
 * - リストとリストの商品: 作成日時の古い順
 * - 履歴: 購入日時の新しい順
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
}

const byCreatedAt = <T extends { createdAt: Date }>(a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime()

export async function queryLists(db: ShoppingMemosDB, options: ListQueryOptions): Promise<ShoppingList[]> {
  const { groupId, status, includeCompleted = false, includeAllGroups = false } = options
  const lists = await db.lists
    .filter((list) => {
      if (!includeAllGroups && list.groupId !== groupId) return false
      if (status && list.status !== status) return false
      if (!includeCompleted && list.status === "completed") return false
      return true
    })
    .toArray()
  return lists.sort(byCreatedAt)
}

export async function queryListItems(db: ShoppingMemosDB, listIds: string[]): Promise<ListItem[]> {
  if (listIds.length === 0) return []
  const items = await db.listItems.where("listId").anyOf(listIds).toArray()
  return items.sort(byCreatedAt)
}

export async function queryHistory(
  db: ShoppingMemosDB,
  options: { groupId: string | undefined; limit?: number; offset?: number }
): Promise<PurchaseHistoryWithItems[]> {
  const lists = await db.lists.filter((list) => list.groupId === options.groupId && !!list.purchasedAt).toArray()
  lists.sort((a, b) => (b.purchasedAt?.getTime() ?? 0) - (a.purchasedAt?.getTime() ?? 0))
  let page = lists
  if (options.offset) page = page.slice(options.offset)
  if (options.limit) page = page.slice(0, options.limit)
  return Promise.all(
    page.map(async (list) => ({ ...list, listItems: await queryListItems(db, [list.id]) }))
  )
}
