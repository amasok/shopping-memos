import { TRPCError } from "@trpc/server"
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
  updateListSchema,
  deleteListSchema,
  removeListItemSchema,
} from "@/shared/schemas"
import { shoppingListRepository } from "@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository"
import { purchaseHistoryRepository } from "@/modules/shopping/infrastructure/repositories/DrizzlePurchaseHistoryRepository"
import { itemRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"
import { ListStatus, isInProgress } from "@/modules/shopping/domain/value-objects/ListStatus"
import { ShoppingService } from "@/modules/shopping/application/services/ShoppingService"

// サービスインスタンス
const shoppingService = new ShoppingService(shoppingListRepository, purchaseHistoryRepository)

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
      return shoppingListRepository.findMany({
        groupId: input.groupId,
        status: input.status as ListStatus | undefined,
        includeCompleted: input.includeCompleted,
      })
    }),

  /** 買い物リストを取得 */
  getList: publicProcedure
    .input(deleteListSchema) // idのみ
    .query(async ({ input }) => {
      const list = await shoppingListRepository.findById(input.id)
      if (!list) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "リストが見つかりません",
        })
      }
      return list
    }),

  /** リスト内アイテムを取得 */
  getListItems: publicProcedure
    .input(getListItemsQuerySchema)
    .query(async ({ input }) => {
      const list = await shoppingListRepository.findById(input.listId)
      if (!list) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "リストが見つかりません",
        })
      }
      return list.items
    }),

  /** 買い物リストを作成 */
  createList: protectedProcedure
    .input(createListSchema)
    .mutation(async ({ input, ctx }) => {
      const listId = crypto.randomUUID()

      // リストを作成
      const list = await shoppingListRepository.create({
        id: listId,
        name: input.name,
        groupId: input.groupId,
      })

      // itemIdsが指定された場合、アイテムを追加
      if (input.itemIds && input.itemIds.length > 0) {
        for (const itemId of input.itemIds) {
          const item = await itemRepository.findById(itemId)
          if (item) {
            await shoppingListRepository.addItem({
              id: crypto.randomUUID(),
              listId,
              name: item.name,
              quantity: item.quantity,
              memo: item.memo,
              tagIds: item.tags.map((t) => t.id),
              groupId: item.groupId,
            })
          }
        }
      }

      // tagIdsが指定された場合、タグに紐づくアイテムを追加
      if (input.tagIds && input.tagIds.length > 0) {
        const items = await itemRepository.findMany({
          tagIds: input.tagIds,
          groupId: input.groupId,
          includePurchased: false,
        })

        for (const item of items) {
          await shoppingListRepository.addItem({
            id: crypto.randomUUID(),
            listId,
            name: item.name,
            quantity: item.quantity,
            memo: item.memo,
            tagIds: item.tags.map((t) => t.id),
            groupId: item.groupId,
          })
        }
      }

      // アイテム付きで返す
      return shoppingListRepository.findById(listId)
    }),

  /** 買い物リストを更新 */
  updateList: protectedProcedure
    .input(updateListSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingListRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを編集する権限がありません",
        })
      }

      return shoppingListRepository.update({
        id: input.id,
        name: input.name,
      })
    }),

  /** 買い物リストを削除 */
  deleteList: protectedProcedure
    .input(deleteListSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingListRepository.canAccess(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを削除する権限がありません",
        })
      }

      await shoppingListRepository.delete(input.id)
      return { success: true }
    }),

  /** リストにアイテムを追加 */
  addItemToList: protectedProcedure
    .input(addItemToListSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingListRepository.canAccess(input.listId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを編集する権限がありません",
        })
      }

      // リストが進行中か確認
      const list = await shoppingListRepository.findById(input.listId)
      if (!list) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "リストが見つかりません",
        })
      }
      if (!isInProgress(list.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "完了したリストにはアイテムを追加できません",
        })
      }

      // アイテム情報を取得
      const item = await itemRepository.findById(input.itemId)
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "アイテムが見つかりません",
        })
      }

      // リストにアイテムを追加（スナップショット）
      return shoppingListRepository.addItem({
        id: crypto.randomUUID(),
        listId: input.listId,
        name: item.name,
        quantity: item.quantity,
        memo: item.memo,
        tagIds: item.tags.map((t) => t.id),
        groupId: item.groupId,
      })
    }),

  /** リストからアイテムを削除 */
  removeItemFromList: protectedProcedure
    .input(removeListItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingListRepository.canAccessItem(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを削除する権限がありません",
        })
      }

      // アイテムのリストが進行中か確認
      const item = await shoppingListRepository.findItemById(input.id)
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "アイテムが見つかりません",
        })
      }

      const list = await shoppingListRepository.findById(item.listId)
      if (list && !isInProgress(list.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "完了したリストからアイテムを削除できません",
        })
      }

      await shoppingListRepository.removeItem(input.id)
      return { success: true }
    }),

  /** アイテムのチェック状態を切り替え */
  checkItem: protectedProcedure
    .input(checkItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingListRepository.canAccessItem(input.listItemId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを更新する権限がありません",
        })
      }

      // アイテムのリストが進行中か確認
      const item = await shoppingListRepository.findItemById(input.listItemId)
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "アイテムが見つかりません",
        })
      }

      const list = await shoppingListRepository.findById(item.listId)
      if (list && !isInProgress(list.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "完了したリストのアイテムは変更できません",
        })
      }

      return shoppingListRepository.updateItem({
        id: input.listItemId,
        checked: input.checked,
      })
    }),

  /** 買い物を完了 */
  finishShopping: protectedProcedure
    .input(finishShoppingSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingListRepository.canAccess(input.listId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを完了する権限がありません",
        })
      }

      try {
        return await shoppingService.finishShopping(
          input.listId,
          ctx.userId,
          input.location
        )
      } catch (error) {
        if (error instanceof Error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          })
        }
        throw error
      }
    }),

  // === 履歴 ===

  /** 購入履歴を取得 */
  getHistory: publicProcedure
    .input(getHistoryQuerySchema)
    .query(async ({ input }) => {
      // TODO: Issue #13 で実装
      return []
    }),

  /** 履歴からアイテムを戻す */
  revertHistory: protectedProcedure
    .input(revertHistorySchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Issue #13 で実装
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "履歴からのリバートは Issue #13 で実装予定です",
      })
    }),

  /** 履歴を削除 */
  deleteHistory: protectedProcedure
    .input(deleteHistorySchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Issue #13 で実装
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "履歴削除は Issue #13 で実装予定です",
      })
    }),
})
