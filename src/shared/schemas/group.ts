import { z } from "zod"
import { LIMITS } from "./limits"

// グループ役割
export const groupRoleSchema = z.enum(["owner", "member"])

export type GroupRole = z.infer<typeof groupRoleSchema>

// グループ作成
export const createGroupSchema = z.object({
  name: z.string().min(1, "名前は必須です").max(50, "名前は50文字以内です"),
})

export type CreateGroupInput = z.infer<typeof createGroupSchema>

// グループ更新
export const updateGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "名前は必須です").max(50, "名前は50文字以内です").optional(),
})

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>

// グループ削除
export const deleteGroupSchema = z.object({
  id: z.string().uuid(),
})

export type DeleteGroupInput = z.infer<typeof deleteGroupSchema>

// 招待コード再生成
export const regenerateInviteCodeSchema = z.object({
  groupId: z.string().uuid(),
})

export type RegenerateInviteCodeInput = z.infer<typeof regenerateInviteCodeSchema>

// メンバー招待（招待リンク生成）
export const inviteMemberSchema = z.object({
  groupId: z.string().uuid(),
})

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

// 招待承認（トークン方式）
export const acceptInviteSchema = z.object({
  token: z.string().min(1, "トークンは必須です").max(LIMITS.inviteToken, "トークンが不正です"),
})

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>

// 招待コードでグループに参加
export const joinByInviteCodeSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .min(6, "招待コードは6〜8文字です")
    .max(8, "招待コードは6〜8文字です"),
})

export type JoinByInviteCodeInput = z.infer<typeof joinByInviteCodeSchema>

// 招待の有効/無効切り替え
export const setInviteEnabledSchema = z.object({
  groupId: z.string().uuid(),
  enabled: z.boolean(),
})

export type SetInviteEnabledInput = z.infer<typeof setInviteEnabledSchema>

// メンバー削除
export const removeMemberSchema = z.object({
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
})

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>

// グループ取得クエリ
export const getGroupsQuerySchema = z.object({
  // ユーザーが所属するグループを取得（userIdはctxから取得）
})

export type GetGroupsQuery = z.infer<typeof getGroupsQuerySchema>

// グループメンバー取得クエリ
export const getGroupMembersQuerySchema = z.object({
  groupId: z.string().uuid(),
})

export type GetGroupMembersQuery = z.infer<typeof getGroupMembersQuerySchema>
