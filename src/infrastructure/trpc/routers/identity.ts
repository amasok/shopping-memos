import { router, publicProcedure, protectedProcedure } from "../server"
import {
  createGroupSchema,
  updateGroupSchema,
  deleteGroupSchema,
  inviteMemberSchema,
  acceptInviteSchema,
  removeMemberSchema,
  getGroupMembersQuerySchema,
} from "@/shared/schemas"

/**
 * Identity コンテキストのルーター
 * 認証・認可・グループ管理
 */
export const identityRouter = router({
  // === グループ ===

  /** ユーザーが所属するグループ一覧を取得 */
  getGroups: protectedProcedure.query(async ({ ctx }) => {
    // TODO: Phase 2で実装
    return []
  }),

  /** グループを作成 */
  createGroup: protectedProcedure
    .input(createGroupSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 2で実装
      throw new Error("Not implemented")
    }),

  /** グループを更新 */
  updateGroup: protectedProcedure
    .input(updateGroupSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 2で実装
      throw new Error("Not implemented")
    }),

  /** グループを削除 */
  deleteGroup: protectedProcedure
    .input(deleteGroupSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 2で実装
      throw new Error("Not implemented")
    }),

  // === メンバー ===

  /** グループメンバー一覧を取得 */
  getGroupMembers: protectedProcedure
    .input(getGroupMembersQuerySchema)
    .query(async ({ input, ctx }) => {
      // TODO: Phase 2で実装
      return []
    }),

  /** 招待リンクを生成 */
  inviteMember: protectedProcedure
    .input(inviteMemberSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 2で実装
      throw new Error("Not implemented")
    }),

  /** 招待を承認 */
  acceptInvite: protectedProcedure
    .input(acceptInviteSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 2で実装
      throw new Error("Not implemented")
    }),

  /** メンバーを削除 */
  removeMember: protectedProcedure
    .input(removeMemberSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 2で実装
      throw new Error("Not implemented")
    }),
})
