/**
 * タグエンティティ
 * アイテムの分類用
 */
export interface Tag {
  id: string
  name: string
  userId: string | null // 作成者
  groupId: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * タグ作成時の入力
 */
export interface CreateTagInput {
  id: string
  name: string
  userId: string // 作成者（必須）
  groupId?: string
}

/**
 * タグ更新時の入力
 */
export interface UpdateTagInput {
  id: string
  name?: string
}

/**
 * タグ取得時のクエリ
 */
export interface GetTagsQuery {
  userId?: string // 個人タグ取得時に必要
  groupId?: string | null
}

/**
 * 使用数付きタグ
 */
export interface TagWithUsageCount extends Tag {
  usageCount: number
}
