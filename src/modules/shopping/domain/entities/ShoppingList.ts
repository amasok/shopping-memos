import type { ListStatus } from "../value-objects/ListStatus"
import type { ListItem } from "./ListItem"

/**
 * 買い物リスト
 */
export interface ShoppingList {
  id: string
  name: string
  status: ListStatus
  groupId: string | null
  createdAt: Date
  completedAt: Date | null
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
