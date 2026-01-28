/**
 * アイテムエンティティ
 * 買いたいものマスタ
 */
export interface Item {
  id: string
  name: string
  quantity: number
  memo: string | null
  groupId: string | null
  purchasedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * アイテム作成時の入力
 */
export interface CreateItemInput {
  id: string
  name: string
  quantity: number
  memo?: string
  groupId?: string
  tagIds?: string[]
}

/**
 * アイテム更新時の入力
 */
export interface UpdateItemInput {
  id: string
  name?: string
  quantity?: number
  memo?: string | null
  tagIds?: string[]
}

/**
 * アイテム取得時のクエリ
 */
export interface GetItemsQuery {
  groupId?: string
  tagIds?: string[]
  searchText?: string
  includePurchased?: boolean
}

/**
 * タグ情報付きアイテム
 */
export interface ItemWithTags extends Item {
  tags: Array<{
    id: string
    name: string
  }>
}
