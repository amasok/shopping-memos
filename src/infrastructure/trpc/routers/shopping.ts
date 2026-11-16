import { TRPCError } from "@trpc/server"
import { router, protectedProcedure } from "../server"
import {
  createListSchema,
  addItemToListSchema,
  addNewItemToListSchema,
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
import { db } from "@/infrastructure/db/drizzle/client"
import { shoppingListRepository } from "@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository"
import { itemRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"
import { tagRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import { CatalogSyncService } from "@/modules/catalog/application/services/CatalogSyncService"
import { groupRepository } from "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository"
import { ListStatus, isInProgress } from "@/modules/shopping/domain/value-objects/ListStatus"
import { ShoppingService } from "@/modules/shopping/application/services/ShoppingService"
import { ShoppingSyncService } from "@/modules/shopping/application/services/ShoppingSyncService"
import {
  getListScope,
  markScopedItemsUnpurchasedByName,
  deleteScopedItemsByName,
} from "@/modules/shopping/application/services/catalogItemScope"
import { verifyGroupMembership } from "../middleware/groupAuth"

// サービスインスタンス
const shoppingService = new ShoppingService(shoppingListRepository)
const shoppingSyncService = new ShoppingSyncService(shoppingListRepository)
const catalogSyncService = new CatalogSyncService(itemRepository, tagRepository)

/**
 * Shopping コンテキストのルーター
 * 買い物フロー・履歴管理
 * 同期ログ記録を統合
 */
export const shoppingRouter = router({
  // === リスト ===

  /** 買い物リスト一覧を取得 */
  getLists: protectedProcedure
    .input(getListsQuerySchema)
    .query(async ({ input, ctx }) => {
      // グループ指定時はメンバーシップを検証
      await verifyGroupMembership(input.groupId, ctx.userId)

      // includeAllGroups時はアクセス可能なグループIDを取得
      let accessibleGroupIds: string[] | undefined
      if (input.includeAllGroups) {
        const userGroups = await groupRepository.findByUserId(ctx.userId)
        accessibleGroupIds = userGroups.map((g) => g.id)
      }

      return shoppingSyncService.getLists({
        userId: ctx.userId,
        // null を undefined に変換（ドメイン層は null を受け付けない）
        groupId: input.groupId ?? undefined,
        status: input.status as ListStatus | undefined,
        includeCompleted: input.includeCompleted,
        includeAllGroups: input.includeAllGroups,
        accessibleGroupIds,
      })
    }),

  /** 買い物リストを取得 */
  getList: protectedProcedure
    .input(deleteListSchema) // idのみ
    .query(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessList(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストにアクセスする権限がありません",
        })
      }

      const list = await shoppingSyncService.getList(input.id)
      if (!list) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "リストが見つかりません",
        })
      }
      return list
    }),

  /** リスト内アイテムを取得 */
  getListItems: protectedProcedure
    .input(getListItemsQuerySchema)
    .query(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessList(input.listId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストにアクセスする権限がありません",
        })
      }

      const list = await shoppingSyncService.getList(input.listId)
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
      // グループ指定時はメンバーシップを検証
      await verifyGroupMembership(input.groupId, ctx.userId)

      const listId = crypto.randomUUID()

      // リストを作成（同期ログ記録付き）
      await shoppingSyncService.createList(
        {
          id: listId,
          name: input.name,
          groupId: input.groupId,
        },
        ctx.userId
      )

      // itemIdsが指定された場合、アイテムを追加
      if (input.itemIds && input.itemIds.length > 0) {
        for (const itemId of input.itemIds) {
          const item = await itemRepository.findById(itemId)
          if (item) {
            await shoppingSyncService.addItem(
              {
                id: crypto.randomUUID(),
                listId,
                name: item.name,
                quantity: item.quantity,
                memo: item.memo,
                tagIds: item.tags.map((t) => t.id),
                groupId: item.groupId,
              },
              ctx.userId
            )
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
          await shoppingSyncService.addItem(
            {
              id: crypto.randomUUID(),
              listId,
              name: item.name,
              quantity: item.quantity,
              memo: item.memo,
              tagIds: item.tags.map((t) => t.id),
              groupId: item.groupId,
            },
            ctx.userId
          )
        }
      }

      // アイテム付きで返す
      return shoppingSyncService.getList(listId)
    }),

  /** 買い物リストを更新 */
  updateList: protectedProcedure
    .input(updateListSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessList(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを編集する権限がありません",
        })
      }

      return shoppingSyncService.updateList(
        {
          id: input.id,
          name: input.name,
        },
        ctx.userId
      )
    }),

  /** 買い物リストを削除 */
  deleteList: protectedProcedure
    .input(deleteListSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessList(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを削除する権限がありません",
        })
      }

      await shoppingSyncService.deleteList(input.id, ctx.userId)
      return { success: true }
    }),

  /** リストにアイテムを追加 */
  addItemToList: protectedProcedure
    .input(addItemToListSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessList(input.listId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを編集する権限がありません",
        })
      }

      // リストが進行中か確認
      const list = await shoppingSyncService.getList(input.listId)
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

      // リストにアイテムを追加（スナップショット、同期ログ記録付き）
      return shoppingSyncService.addItem(
        {
          id: crypto.randomUUID(),
          listId: input.listId,
          name: item.name,
          quantity: item.quantity,
          memo: item.memo,
          tagIds: item.tags.map((t) => t.id),
          groupId: item.groupId,
        },
        ctx.userId
      )
    }),

  /** リストに新規アイテムを追加（直接入力） */
  addNewItemToList: protectedProcedure
    .input(addNewItemToListSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessList(input.listId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このリストを編集する権限がありません",
        })
      }

      // リストが進行中か確認
      const list = await shoppingSyncService.getList(input.listId)
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

      // カタログにもアイテムを作成（リストから外した時に「買いたいもの」に戻れるようにする）
      const catalogItemId = crypto.randomUUID()
      await catalogSyncService.createItem(
        {
          id: catalogItemId,
          name: input.name,
          quantity: input.quantity ?? 1,
          memo: input.memo,
          userId: ctx.userId,
          groupId: list.groupId ?? undefined,
          tagIds: input.tagIds ?? [],
        },
        ctx.userId
      )

      // リストにアイテムを追加（スナップショット、同期ログ記録付き）
      return shoppingSyncService.addItem(
        {
          id: crypto.randomUUID(),
          listId: input.listId,
          name: input.name,
          quantity: input.quantity ?? 1,
          memo: input.memo,
          tagIds: input.tagIds ?? [],
          groupId: list.groupId,
        },
        ctx.userId
      )
    }),

  /** リストからアイテムを削除 */
  removeItemFromList: protectedProcedure
    .input(removeListItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessItem(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを削除する権限がありません",
        })
      }

      // アイテムのリストが進行中か確認
      const item = await shoppingSyncService.getItem(input.id)
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "アイテムが見つかりません",
        })
      }

      const list = await shoppingSyncService.getList(item.listId)
      if (list && !isInProgress(list.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "完了したリストからアイテムを削除できません",
        })
      }

      await shoppingSyncService.removeItem(input.id, ctx.userId)
      return { success: true }
    }),

  /** アイテムのチェック状態を切り替え */
  checkItem: protectedProcedure
    .input(checkItemSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessItem(input.listItemId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムを更新する権限がありません",
        })
      }

      // アイテムのリストが進行中か確認
      const item = await shoppingSyncService.getItem(input.listItemId)
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "アイテムが見つかりません",
        })
      }

      const list = await shoppingSyncService.getList(item.listId)
      if (list && !isInProgress(list.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "完了したリストのアイテムは変更できません",
        })
      }

      return shoppingSyncService.updateItem(
        {
          id: input.listItemId,
          checked: input.checked,
        },
        ctx.userId
      )
    }),

  /** 買い物を完了 */
  finishShopping: protectedProcedure
    .input(finishShoppingSchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessList(input.listId, ctx.userId)
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

  // === 履歴（purchasedAtが入っているリスト） ===

  /** 購入履歴一覧を取得 */
  getHistory: protectedProcedure
    .input(getHistoryQuerySchema)
    .query(async ({ input, ctx }) => {
      // グループ指定時はメンバーシップを検証
      await verifyGroupMembership(input.groupId, ctx.userId)

      return shoppingSyncService.getHistory({
        userId: ctx.userId,
        groupId: input.groupId ?? undefined,
        limit: input.limit,
        offset: input.offset,
      })
    }),

  /** 購入履歴を取得 */
  getHistoryById: protectedProcedure
    .input(deleteHistorySchema) // idのみ
    .query(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessHistory(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "この履歴にアクセスする権限がありません",
        })
      }

      const history = await shoppingSyncService.getHistoryById(input.id)
      if (!history) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "履歴が見つかりません",
        })
      }
      return history
    }),

  /** 履歴からリストに戻す */
  revertHistory: protectedProcedure
    .input(revertHistorySchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認（listIdとして扱う）
      const canAccess = await shoppingSyncService.canAccessHistory(input.historyId, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "この履歴を操作する権限がありません",
        })
      }

      // 履歴（リスト）を取得
      const history = await shoppingSyncService.getHistoryById(input.historyId)
      if (!history) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "履歴が見つかりません",
        })
      }

      // リストに含まれるアイテムのカタログアイテムを未購入に戻す
      // リストと同じスコープ（グループ or 作成者の個人データ）のアイテムに限定する
      const revertedItemIds: string[] = []
      const scope = await getListScope(db, input.historyId)
      if (scope) {
        for (const listItem of history.items) {
          const ids = await markScopedItemsUnpurchasedByName(db, scope, listItem.name)
          for (const catalogItemId of ids) {
            revertedItemIds.push(catalogItemId)

            // 同期ログを記録
            await syncRepository.createOperation({
              id: crypto.randomUUID(),
              userId: ctx.userId,
              entity: "item",
              entityId: catalogItemId,
              operation: "update",
              payload: { id: catalogItemId, purchasedAt: null },
            })
          }
        }
      }

      // リストを未購入に戻す
      const list = await shoppingSyncService.revertHistory(input.historyId, ctx.userId)

      return {
        success: true,
        list,
        revertedItemIds,
      }
    }),

  /** 履歴を削除（リストとアイテムも削除） */
  deleteHistory: protectedProcedure
    .input(deleteHistorySchema)
    .mutation(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await shoppingSyncService.canAccessHistory(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "この履歴を削除する権限がありません",
        })
      }

      // 履歴（リスト）を取得
      const history = await shoppingSyncService.getHistoryById(input.id)
      if (!history) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "履歴が見つかりません",
        })
      }

      // リストに含まれるアイテムに対応するカタログアイテムを削除
      // リストと同じスコープ（グループ or 作成者の個人データ）のアイテムに限定する
      const scope = await getListScope(db, input.id)
      if (scope) {
        for (const listItem of history.items) {
          const ids = await deleteScopedItemsByName(db, scope, listItem.name)
          for (const catalogItemId of ids) {
            // 同期ログを記録
            await syncRepository.createOperation({
              id: crypto.randomUUID(),
              userId: ctx.userId,
              entity: "item",
              entityId: catalogItemId,
              operation: "delete",
              payload: { id: catalogItemId },
            })
          }
        }
      }

      // リストを削除（list_itemsはcascadeで削除される）
      await shoppingSyncService.deleteHistory(input.id, ctx.userId)

      return { success: true }
    }),
})
