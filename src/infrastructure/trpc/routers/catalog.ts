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
import { itemRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"

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
      return itemRepository.findMany({
        groupId: input.groupId,
        tagIds: input.tagIds,
        searchText: input.searchText,
        includePurchased: input.includePurchased,
      })
    }),

  /** アイテムを取得 */
  getItem: publicProcedure
    .input(deleteItemSchema) // idのみ
    .query(async ({ input }) => {
      const item = await itemRepository.findById(input.id)
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "アイテムが見つかりません",
        })
      }
      return item
    }),

  /** アイテムを作成 */
  createItem: protectedProcedure
    .input(createItemSchema)
    .mutation(async ({ input, ctx }) => {
      const item = await itemRepository.create({
        id: crypto.randomUUID(),
        name: input.name,
        quantity: input.quantity,
        memo: input.memo,
        groupId: input.groupId,
        tagIds: input.tagIds,
      })

      return item
    }),

  /** アイテムを更新 */
  updateItem: protectedProcedure
    .input(updateItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await itemRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを編集する権限がありません",
        })
      }

      return itemRepository.update({
        id: input.id,
        name: input.name,
        quantity: input.quantity,
        memo: input.memo,
        tagIds: input.tagIds,
      })
    }),

  /** アイテムを削除 */
  deleteItem: protectedProcedure
    .input(deleteItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await itemRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを削除する権限がありません",
        })
      }

      await itemRepository.delete(input.id)
      return { success: true }
    }),

  /** アイテムを購入済みにする */
  markItemAsPurchased: protectedProcedure
    .input(deleteItemSchema) // idのみ
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await itemRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを更新する権限がありません",
        })
      }

      return itemRepository.markAsPurchased(input.id)
    }),

  /** アイテムを未購入に戻す */
  markItemAsUnpurchased: protectedProcedure
    .input(deleteItemSchema) // idのみ
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await itemRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを更新する権限がありません",
        })
      }

      return itemRepository.markAsUnpurchased(input.id)
    }),

  // === タグ ===

  /** タグ一覧を取得 */
  getTags: publicProcedure
    .input(getTagsQuerySchema)
    .query(async ({ input }) => {
      // TODO: Phase 3 Issue #9 で実装
      return []
    }),

  /** タグを作成 */
  createTag: protectedProcedure
    .input(createTagSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3 Issue #9 で実装
      throw new Error("Not implemented")
    }),

  /** タグを更新 */
  updateTag: protectedProcedure
    .input(updateTagSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3 Issue #9 で実装
      throw new Error("Not implemented")
    }),

  /** タグを削除 */
  deleteTag: protectedProcedure
    .input(deleteTagSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3 Issue #9 で実装
      throw new Error("Not implemented")
    }),
})
