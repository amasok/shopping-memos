/**
 * グループメンバーエンティティ
 * グループとユーザーの関連
 */
export interface GroupMember {
  id: string
  groupId: string
  userId: string
  role: GroupRole
  joinedAt: Date
}

/**
 * グループ内での役割
 * - owner: グループ管理者（招待、削除が可能）
 * - member: 一般メンバー
 */
export type GroupRole = "owner" | "member"

/**
 * グループメンバー作成時の入力
 */
export interface CreateGroupMemberInput {
  id: string
  groupId: string
  userId: string
  role: GroupRole
}

/**
 * メンバー情報（ユーザー情報付き）
 */
export interface GroupMemberWithUser extends GroupMember {
  user: {
    id: string
    name: string | null
    email: string
    image: string | null
  }
}
