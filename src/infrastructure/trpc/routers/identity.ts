import { TRPCError } from "@trpc/server"
import { router, protectedProcedure } from "../server"
import {
  createGroupSchema,
  updateGroupSchema,
  deleteGroupSchema,
  regenerateInviteCodeSchema,
  inviteMemberSchema,
  acceptInviteSchema,
  joinByInviteCodeSchema,
  removeMemberSchema,
  getGroupMembersQuerySchema,
} from "@/shared/schemas"
import { groupRepository } from "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository"
import {
  INVITE_LINK_EXPIRY_DAYS,
  INVITE_TOKEN_LENGTH,
} from "@/modules/identity/domain/entities/InviteLink"

/**
 * 安全な招待トークンを生成
 * 256ビット（32バイト）のランダムトークン
 */
function generateInviteToken(): string {
  const bytes = new Uint8Array(INVITE_TOKEN_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Identity コンテキストのルーター
 * 認証・認可・グループ管理
 */
export const identityRouter = router({
  // === グループ ===

  /** ユーザーが所属するグループ一覧を取得 */
  getGroups: protectedProcedure.query(async ({ ctx }) => {
    return groupRepository.findByUserId(ctx.userId)
  }),

  /** グループを作成 */
  createGroup: protectedProcedure
    .input(createGroupSchema)
    .mutation(async ({ input, ctx }) => {
      const group = await groupRepository.createWithOwner({
        id: crypto.randomUUID(),
        name: input.name,
        ownerId: ctx.userId,
      })

      return group
    }),

  /** グループを更新 */
  updateGroup: protectedProcedure
    .input(updateGroupSchema)
    .mutation(async ({ input, ctx }) => {
      // オーナーのみ更新可能
      const isOwner = await groupRepository.isOwner(input.id, ctx.userId)
      if (!isOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "グループの更新はオーナーのみ可能です",
        })
      }

      return groupRepository.update(input)
    }),

  /** グループを削除 */
  deleteGroup: protectedProcedure
    .input(deleteGroupSchema)
    .mutation(async ({ input, ctx }) => {
      // オーナーのみ削除可能
      const isOwner = await groupRepository.isOwner(input.id, ctx.userId)
      if (!isOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "グループの削除はオーナーのみ可能です",
        })
      }

      await groupRepository.delete(input.id)
      return { success: true }
    }),

  /** 招待コードを再生成 */
  regenerateInviteCode: protectedProcedure
    .input(regenerateInviteCodeSchema)
    .mutation(async ({ input, ctx }) => {
      // オーナーのみ再生成可能
      const isOwner = await groupRepository.isOwner(input.groupId, ctx.userId)
      if (!isOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "招待コードの再生成はオーナーのみ可能です",
        })
      }

      return groupRepository.regenerateInviteCode(input.groupId)
    }),

  // === メンバー ===

  /** グループメンバー一覧を取得 */
  getGroupMembers: protectedProcedure
    .input(getGroupMembersQuerySchema)
    .query(async ({ input, ctx }) => {
      // メンバーのみ閲覧可能
      const isMember = await groupRepository.isMember(input.groupId, ctx.userId)
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "グループのメンバーのみ閲覧可能です",
        })
      }

      return groupRepository.findMembers(input.groupId)
    }),

  /** 招待リンクを生成 */
  inviteMember: protectedProcedure
    .input(inviteMemberSchema)
    .mutation(async ({ input, ctx }) => {
      // オーナーのみ招待可能
      const isOwner = await groupRepository.isOwner(input.groupId, ctx.userId)
      if (!isOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "招待はオーナーのみ可能です",
        })
      }

      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + INVITE_LINK_EXPIRY_DAYS)

      const invite = await groupRepository.createInvite({
        id: crypto.randomUUID(),
        groupId: input.groupId,
        token: generateInviteToken(),
        expiresAt,
      })

      return {
        token: invite.token,
        expiresAt: invite.expiresAt,
      }
    }),

  /** 招待を承認 */
  acceptInvite: protectedProcedure
    .input(acceptInviteSchema)
    .mutation(async ({ input, ctx }) => {
      const invite = await groupRepository.findInviteByToken(input.token)

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "招待リンクが見つかりません",
        })
      }

      // 有効期限チェック
      if (new Date() > invite.expiresAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "招待リンクの有効期限が切れています",
        })
      }

      // 使用済みチェック
      if (invite.usedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "この招待リンクは既に使用されています",
        })
      }

      // 既にメンバーか確認
      const isMember = await groupRepository.isMember(invite.groupId, ctx.userId)
      if (isMember) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "既にこのグループのメンバーです",
        })
      }

      // メンバーとして追加
      await groupRepository.addMember({
        id: crypto.randomUUID(),
        groupId: invite.groupId,
        userId: ctx.userId,
        role: "member",
      })

      // 招待を使用済みにする
      await groupRepository.markInviteAsUsed(invite.id, ctx.userId)

      // グループ情報を返す
      const group = await groupRepository.findById(invite.groupId)
      return group
    }),

  /** 招待コードでグループに参加 */
  joinByInviteCode: protectedProcedure
    .input(joinByInviteCodeSchema)
    .mutation(async ({ input, ctx }) => {
      // 招待コードでグループを検索
      const group = await groupRepository.findByInviteCode(input.inviteCode)

      if (!group) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "招待コードが見つかりません",
        })
      }

      // 既にメンバーか確認
      const isMember = await groupRepository.isMember(group.id, ctx.userId)
      if (isMember) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "既にこのグループのメンバーです",
        })
      }

      // メンバーとして追加
      await groupRepository.addMember({
        id: crypto.randomUUID(),
        groupId: group.id,
        userId: ctx.userId,
        role: "member",
      })

      return group
    }),

  /** メンバーを削除 */
  removeMember: protectedProcedure
    .input(removeMemberSchema)
    .mutation(async ({ input, ctx }) => {
      // オーナーのみ他のメンバーを削除可能
      // または自分自身を削除可能（脱退）
      const isOwner = await groupRepository.isOwner(input.groupId, ctx.userId)
      const isSelf = input.userId === ctx.userId

      if (!isOwner && !isSelf) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "メンバーの削除はオーナーのみ可能です",
        })
      }

      // オーナー自身の削除は不可
      const isTargetOwner = await groupRepository.isOwner(input.groupId, input.userId)
      if (isTargetOwner) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "オーナーは削除できません。グループを削除してください。",
        })
      }

      await groupRepository.removeMember(input.groupId, input.userId)
      return { success: true }
    }),
})
