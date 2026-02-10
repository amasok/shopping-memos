/**
 * グループエンティティ
 * 買い物リストを共有する単位
 */
export interface Group {
  id: string
  name: string
  inviteCode: string // 6文字の招待コード
  inviteEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * メンバー数付きグループ
 * 一覧表示用
 */
export interface GroupWithMemberCount extends Group {
  memberCount: number
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
