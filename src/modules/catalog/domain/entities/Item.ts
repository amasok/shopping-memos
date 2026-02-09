/**
 * アイテムエンティティ
 * 買いたいものマスタ
 */
export interface Item {
  id: string
  name: string
  quantity: number
  memo: string | null
  userId: string | null // 作成者
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
  userId: string // 作成者（必須）
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
 * userId + groupId = null → 個人アイテム
 * groupId != null → グループアイテム
 */
export interface GetItemsQuery {
  userId?: string // 個人アイテム取得時に必要
  groupId?: string | null // nullを明示的に渡せる
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
