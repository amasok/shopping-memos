/**
 * グループエンティティ
 * 買い物リストを共有する単位
 */
export interface Group {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
}

/**
 * グループ作成時の入力
 */
export interface CreateGroupInput {
  id: string
  name: string
  ownerId: string
}

/**
 * グループ更新時の入力
 */
export interface UpdateGroupInput {
  id: string
  name?: string
}
