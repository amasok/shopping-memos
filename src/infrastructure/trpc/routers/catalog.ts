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
import { tagRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"
import { CatalogSyncService } from "@/modules/catalog/application/services/CatalogSyncService"

// 同期サービスインスタンス
const catalogSyncService = new CatalogSyncService(itemRepository, tagRepository)

/**
 * Catalog コンテキストのルーター
 * 買いたいもの・タグのマスタ管理
 * 同期ログ記録を統合
 */
export const catalogRouter = router({
  // === アイテム ===

  /** アイテム一覧を取得 */
  getItems: publicProcedure
    .input(getItemsQuerySchema)
    .query(async ({ input }) => {
      return catalogSyncService.getItems({
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
      const item = await catalogSyncService.getItem(input.id)
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
      return catalogSyncService.createItem(
        {
          id: crypto.randomUUID(),
          name: input.name,
          quantity: input.quantity,
          memo: input.memo,
          groupId: input.groupId,
          tagIds: input.tagIds,
        },
        ctx.userId
      )
    }),

  /** アイテムを更新 */
  updateItem: protectedProcedure
    .input(updateItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessItem(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを編集する権限がありません",
        })
      }

      return catalogSyncService.updateItem(
        {
          id: input.id,
          name: input.name,
          quantity: input.quantity,
          memo: input.memo,
          tagIds: input.tagIds,
        },
        ctx.userId
      )
    }),

  /** アイテムを削除 */
  deleteItem: protectedProcedure
    .input(deleteItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessItem(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを削除する権限がありません",
        })
      }

      await catalogSyncService.deleteItem(input.id, ctx.userId)
      return { success: true }
    }),

  /** アイテムを購入済みにする */
  markItemAsPurchased: protectedProcedure
    .input(deleteItemSchema) // idのみ
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessItem(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを更新する権限がありません",
        })
      }

      return catalogSyncService.markItemAsPurchased(input.id, ctx.userId)
    }),

  /** アイテムを未購入に戻す */
  markItemAsUnpurchased: protectedProcedure
    .input(deleteItemSchema) // idのみ
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessItem(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを更新する権限がありません",
        })
      }

      return catalogSyncService.markItemAsUnpurchased(input.id, ctx.userId)
    }),

  // === タグ ===

  /** タグ一覧を取得 */
  getTags: publicProcedure
    .input(getTagsQuerySchema)
    .query(async ({ input }) => {
      return catalogSyncService.getTags({
        groupId: input.groupId,
      })
    }),

  /** タグを取得 */
  getTag: publicProcedure
    .input(deleteTagSchema) // idのみ
    .query(async ({ input }) => {
      const tag = await catalogSyncService.getTag(input.id)
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
      return catalogSyncService.createTag(
        {
          id: crypto.randomUUID(),
          name: input.name,
          groupId: input.groupId,
        },
        ctx.userId
      )
    }),

  /** タグを更新 */
  updateTag: protectedProcedure
    .input(updateTagSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessTag(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このタグを編集する権限がありません",
        })
      }

      return catalogSyncService.updateTag(
        {
          id: input.id,
          name: input.name,
        },
        ctx.userId
      )
    }),

  /** タグを削除 */
  deleteTag: protectedProcedure
    .input(deleteTagSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessTag(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このタグを削除する権限がありません",
        })
      }

      await catalogSyncService.deleteTag(input.id, ctx.userId)
      return { success: true }
    }),
})
