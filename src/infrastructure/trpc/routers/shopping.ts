import { router, publicProcedure, protectedProcedure } from "../server"
import {
  createListSchema,
  addItemToListSchema,
  checkItemSchema,
  finishShoppingSchema,
  getListsQuerySchema,
  getListItemsQuerySchema,
  getHistoryQuerySchema,
  revertHistorySchema,
  deleteHistorySchema,
} from "@/shared/schemas"

/**
 * Shopping コンテキストのルーター
 * 買い物フロー・履歴管理
 */
export const shoppingRouter = router({
  // === リスト ===

  /** 買い物リスト一覧を取得 */
  getLists: publicProcedure
    .input(getListsQuerySchema)
    .query(async ({ input }) => {
      // TODO: Phase 4で実装
      return []
    }),

  /** リスト内アイテムを取得 */
  getListItems: publicProcedure
    .input(getListItemsQuerySchema)
    .query(async ({ input }) => {
      // TODO: Phase 4で実装
      return []
    }),

  /** 買い物リストを作成 */
  createList: protectedProcedure
    .input(createListSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 4で実装
      throw new Error("Not implemented")
    }),

  /** リストにアイテムを追加 */
  addItemToList: protectedProcedure
    .input(addItemToListSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 4で実装
      throw new Error("Not implemented")
    }),

  /** アイテムのチェック状態を切り替え */
  checkItem: protectedProcedure
    .input(checkItemSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 4で実装
      throw new Error("Not implemented")
    }),

  /** 買い物を完了 */
  finishShopping: protectedProcedure
    .input(finishShoppingSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 4で実装
      throw new Error("Not implemented")
    }),

  // === 履歴 ===

  /** 購入履歴を取得 */
  getHistory: publicProcedure
    .input(getHistoryQuerySchema)
    .query(async ({ input }) => {
      // TODO: Phase 4で実装
      return []
    }),

  /** 履歴からアイテムを戻す */
  revertHistory: protectedProcedure
    .input(revertHistorySchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 4で実装
      throw new Error("Not implemented")
    }),

  /** 履歴を削除 */
  deleteHistory: protectedProcedure
    .input(deleteHistorySchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Phase 4で実装
      throw new Error("Not implemented")
    }),
})
