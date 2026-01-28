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
      // TODO: Phase 3で実装
      return []
    }),

  /** アイテムを作成 */
  createItem: protectedProcedure
    .input(createItemSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3で実装
      throw new Error("Not implemented")
    }),

  /** アイテムを更新 */
  updateItem: protectedProcedure
    .input(updateItemSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3で実装
      throw new Error("Not implemented")
    }),

  /** アイテムを削除 */
  deleteItem: protectedProcedure
    .input(deleteItemSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3で実装
      throw new Error("Not implemented")
    }),

  // === タグ ===

  /** タグ一覧を取得 */
  getTags: publicProcedure
    .input(getTagsQuerySchema)
    .query(async ({ input }) => {
      // TODO: Phase 3で実装
      return []
    }),

  /** タグを作成 */
  createTag: protectedProcedure
    .input(createTagSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3で実装
      throw new Error("Not implemented")
    }),

  /** タグを更新 */
  updateTag: protectedProcedure
    .input(updateTagSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3で実装
      throw new Error("Not implemented")
    }),

  /** タグを削除 */
  deleteTag: protectedProcedure
    .input(deleteTagSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 3で実装
      throw new Error("Not implemented")
    }),
})
