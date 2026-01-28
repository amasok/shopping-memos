import { TRPCError } from "@trpc/server"
import { router, publicProcedure, protectedProcedure } from "../server"
import {
  createItemSchema,
  updateItemSchema,
  deleteItemSchema,
  getItemsQuerySchema,
  createTagSchema,
  updateTagSchema,
  deleteTagSchema,
  getTagsQuerySchema,
} from "@/shared/schemas"
import { tagRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"

/**
 * Catalog コンテキストのルーター
 * 買いたいもの・タグのマスタ管理
 */
export const catalogRouter = router({
  // === アイテム ===

  /** アイテム一覧を取得 */
  getItems: publicProcedure
    .input(getItemsQuerySchema)
    .query(async ({ input }) => {
      // TODO: Phase 3 Issue #8 で実装（マージ後に統合）
      return []
    }),

  /** アイテムを作成 */
  createItem: protectedProcedure
    .input(createItemSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3 Issue #8 で実装（マージ後に統合）
      throw new Error("Not implemented")
    }),

  /** アイテムを更新 */
  updateItem: protectedProcedure
    .input(updateItemSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3 Issue #8 で実装（マージ後に統合）
      throw new Error("Not implemented")
    }),

  /** アイテムを削除 */
  deleteItem: protectedProcedure
    .input(deleteItemSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3 Issue #8 で実装（マージ後に統合）
      throw new Error("Not implemented")
    }),

  // === タグ ===

  /** タグ一覧を取得 */
  getTags: publicProcedure
    .input(getTagsQuerySchema)
    .query(async ({ input }) => {
      return tagRepository.findMany({
        groupId: input.groupId,
      })
    }),

  /** タグを取得 */
  getTag: publicProcedure
    .input(deleteTagSchema) // idのみ
    .query(async ({ input }) => {
      const tag = await tagRepository.findById(input.id)
      if (!tag) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "タグが見つかりません",
        })
      }
      return tag
    }),

  /** タグを作成 */
  createTag: protectedProcedure
    .input(createTagSchema)
    .mutation(async ({ input, ctx }) => {
      const tag = await tagRepository.create({
        id: crypto.randomUUID(),
        name: input.name,
        groupId: input.groupId,
      })

      return tag
    }),

  /** タグを更新 */
  updateTag: protectedProcedure
    .input(updateTagSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await tagRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このタグを編集する権限がありません",
        })
      }

      return tagRepository.update({
        id: input.id,
        name: input.name,
      })
    }),

  /** タグを削除 */
  deleteTag: protectedProcedure
    .input(deleteTagSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await tagRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このタグを削除する権限がありません",
        })
      }

      await tagRepository.delete(input.id)
      return { success: true }
    }),
})
