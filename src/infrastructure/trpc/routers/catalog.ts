import { TRPCError } from "@trpc/server"
import { notDeleted } from "@/infrastructure/db/syncColumns"
import { eq, and, isNull } from "drizzle-orm"
import { router, protectedProcedure } from "../server"
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
import { db } from "@/infrastructure/db/drizzle/client"
import { shoppingLists, listItems } from "@/infrastructure/db/drizzle/schema"
import { itemRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"
import { tagRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"
import { CatalogSyncService } from "@/modules/catalog/application/services/CatalogSyncService"
import { areTagsInScope } from "@/modules/catalog/application/services/ownership"
import { verifyGroupMembership } from "../middleware/groupAuth"

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
  getItems: protectedProcedure
    .input(getItemsQuerySchema)
    .query(async ({ input, ctx }) => {
      // グループ指定時はメンバーシップを検証
      await verifyGroupMembership(input.groupId, ctx.userId)

      // デバッグログ
      if (process.env.NODE_ENV !== "production") {
        console.log("[catalog.getItems] input:", {
          groupId: input.groupId,
          userId: ctx.userId,
          tagIds: input.tagIds,
          includePurchased: input.includePurchased,
        })
      }

      // カタログアイテムを取得
      const items = await catalogSyncService.getItems({
        userId: ctx.userId,
        // null を undefined に変換（ドメイン層は null を受け付けない）
        groupId: input.groupId ?? undefined,
        tagIds: input.tagIds,
        searchText: input.searchText,
        includePurchased: input.includePurchased,
      })

      // 進行中のリストに含まれるアイテム名を取得（除外用）
      // グループ指定時はグループのリスト、個人時はユーザーのリスト
      const listConditions = [
        eq(shoppingLists.status, "in_progress"),
        notDeleted(shoppingLists),
        notDeleted(listItems),
      ]
      if (input.groupId) {
        listConditions.push(eq(shoppingLists.groupId, input.groupId))
      } else {
        listConditions.push(isNull(shoppingLists.groupId))
        listConditions.push(eq(shoppingLists.userId, ctx.userId))
      }

      const activeListItems = await db
        .select({ name: listItems.name })
        .from(listItems)
        .innerJoin(shoppingLists, eq(listItems.listId, shoppingLists.id))
        .where(and(...listConditions))

      const namesInActiveLists = new Set(activeListItems.map((item) => item.name))

      // 進行中リストに含まれるアイテムを除外
      return items.filter((item) => !namesInActiveLists.has(item.name))
    }),

  /** アイテムを取得 */
  getItem: protectedProcedure
    .input(deleteItemSchema) // idのみ
    .query(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessItem(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このアイテムにアクセスする権限がありません",
        })
      }

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
      // グループ指定時はメンバーシップを検証
      await verifyGroupMembership(input.groupId, ctx.userId)

      // タグはアイテムと同じスコープのものに限定
      const tagsOk = await areTagsInScope(input.tagIds, {
        userId: ctx.userId,
        groupId: input.groupId,
      })
      if (!tagsOk) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "指定されたタグを使用する権限がありません",
        })
      }

      return catalogSyncService.createItem(
        {
          id: input.id ?? crypto.randomUUID(),
          name: input.name,
          quantity: input.quantity,
          memo: input.memo,
          userId: ctx.userId,
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

      // タグはアイテムと同じスコープのものに限定
      if (input.tagIds !== undefined) {
        const item = await itemRepository.findById(input.id)
        const tagsOk = item !== null && (await areTagsInScope(input.tagIds, item))
        if (!tagsOk) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "指定されたタグを使用する権限がありません",
          })
        }
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
  getTags: protectedProcedure
    .input(getTagsQuerySchema)
    .query(async ({ input, ctx }) => {
      // グループ指定時はメンバーシップを検証
      await verifyGroupMembership(input.groupId, ctx.userId)

      return catalogSyncService.getTags({
        userId: ctx.userId,
        // null を undefined に変換（ドメイン層は null を受け付けない）
        groupId: input.groupId ?? undefined,
      })
    }),

  /** タグを取得 */
  getTag: protectedProcedure
    .input(deleteTagSchema) // idのみ
    .query(async ({ input, ctx }) => {
      // アクセス権確認
      const canAccess = await catalogSyncService.canAccessTag(input.id, ctx.userId)
      if (!canAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "このタグにアクセスする権限がありません",
        })
      }

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
      // グループ指定時はメンバーシップを検証
      await verifyGroupMembership(input.groupId, ctx.userId)

      return catalogSyncService.createTag(
        {
          id: input.id ?? crypto.randomUUID(),
          name: input.name,
          userId: ctx.userId,
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
