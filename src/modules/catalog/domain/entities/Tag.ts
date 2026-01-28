/**
 * タグエンティティ
 * アイテムの分類用
 */
export interface Tag {
  id: string
  name: string
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
  groupId?: string
}

/**
 * 使用数付きタグ
 */
export interface TagWithUsageCount extends Tag {
  usageCount: number
}
