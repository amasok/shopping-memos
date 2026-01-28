/**
 * リスト内アイテム
 * Catalog.Itemのスナップショット
 */
export interface ListItem {
  id: string
  listId: string
  name: string
  quantity: number
  memo: string | null
  tagIds: string[] | null
  groupId: string | null
  checked: boolean
  createdAt: Date
}

/**
 * リストアイテム作成入力
 */
export interface CreateListItemInput {
  id: string
  listId: string
  name: string
  quantity: number
  memo?: string | null
  tagIds?: string[] | null
  groupId?: string | null
}

/**
 * リストアイテム更新入力
 */
export interface UpdateListItemInput {
  id: string
  checked?: boolean
}
