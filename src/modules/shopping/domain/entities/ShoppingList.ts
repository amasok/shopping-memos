import type { ListStatus } from "../value-objects/ListStatus"
import type { ListItem } from "./ListItem"

/**
 * 買い物リスト
 * purchasedAtが入っていれば購入履歴として表示
 */
export interface ShoppingList {
  id: string
  name: string
  status: ListStatus
  groupId: string | null
  createdAt: Date
  completedAt: Date | null
  purchasedAt: Date | null  // 購入日時（購入履歴として表示）
  location: string | null   // 購入場所
}

/**
 * タグ情報付きリストアイテム
 */
export interface ListItemWithTags extends ListItem {
  tags: { id: string; name: string }[]
}

/**
 * アイテム付き買い物リスト
 */
export interface ShoppingListWithItems extends ShoppingList {
  items: ListItemWithTags[]
}

/**
 * 買い物リスト作成入力
 */
export interface CreateShoppingListInput {
  id: string
  name: string
  groupId?: string | null
}

/**
 * 買い物リスト更新入力
 */
export interface UpdateShoppingListInput {
  id: string
  name?: string
  status?: ListStatus
  completedAt?: Date | null
  purchasedAt?: Date | null
  location?: string | null
}

/**
 * 買い物リスト取得クエリ
 */
export interface GetShoppingListsQuery {
  groupId?: string
  status?: ListStatus
  includeCompleted?: boolean
  /** trueの場合、groupIdフィルタを無視して全リストを返す */
  includeAllGroups?: boolean
}

/**
 * 購入履歴取得クエリ（purchasedAtが入っているリスト）
 */
export interface GetPurchaseHistoryQuery {
  groupId?: string
  limit?: number
  offset?: number
}
