/**
 * 招待リンクエンティティ
 * グループへの招待を管理
 */
export interface InviteLink {
  id: string
  groupId: string
  token: string
  expiresAt: Date
  usedAt: Date | null
  usedBy: string | null
  createdAt: Date
}

/**
 * 招待リンク作成時の入力
 */
export interface CreateInviteLinkInput {
  id: string
  groupId: string
  token: string
  expiresAt: Date
}

/**
 * 招待リンクの有効期限（7日）
 */
export const INVITE_LINK_EXPIRY_DAYS = 7

/**
 * 招待トークンの長さ（バイト）
 * 256ビット = 32バイト
 */
export const INVITE_TOKEN_LENGTH = 32
