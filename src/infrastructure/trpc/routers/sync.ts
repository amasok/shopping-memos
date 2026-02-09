import { router, protectedProcedure } from "../server"
import {
  syncPushInputSchema,
  syncPullInputSchema,
  syncMergeInputSchema,
} from "@/shared/schemas/sync"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import { groupRepository } from "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository"
import { dataMergeService } from "@/modules/sync/application/services/DataMergeService"
import type { SyncConflict } from "@/modules/sync/domain/entities/SyncOperation"

/**
 * Last Write Wins による競合解決
 */
function resolveConflict(
  localTime: Date,
  serverTime: Date
): "local" | "server" {
  return localTime.getTime() > serverTime.getTime() ? "local" : "server"
}

/**
 * Sync コンテキストのルーター
 * クライアント-サーバー間のデータ同期
 */
export const syncRouter = router({
  /**
   * ローカル操作をサーバーにプッシュ
   * - 各操作を処理し、成功したIDと競合を返す
   * - Last Write Winsで競合解決
   */
  push: protectedProcedure
    .input(syncPushInputSchema)
    .mutation(async ({ input, ctx }) => {
      const processedIds: string[] = []
      const conflicts: SyncConflict[] = []

      for (const op of input.operations) {
        try {
          // サーバー側の最新状態を確認
          const serverState = await syncRepository.findLatestEntityState(
            op.entity,
            op.entityId
          )

          if (serverState) {
            // 競合チェック（Last Write Wins）
            const winner = resolveConflict(op.createdAt, serverState.createdAt)

            if (winner === "server") {
              // サーバーが勝ち → 競合として返す
              conflicts.push({
                operationId: op.id,
                entity: op.entity,
                entityId: op.entityId,
                serverData: JSON.parse(serverState.payload),
                serverUpdatedAt: serverState.createdAt,
              })
              continue
            }
          }

          // ローカルが勝ち or 新規 → 操作を記録
          await syncRepository.createOperation({
            id: op.id,
            userId: ctx.userId,
            entity: op.entity,
            entityId: op.entityId,
            operation: op.operation,
            payload: op.payload,
          })

          processedIds.push(op.id)
        } catch (error) {
          console.error(`Sync operation failed: ${op.id}`, error)
          // 個別操作のエラーは無視して続行
        }
      }

      return { processedIds, conflicts }
    }),

  /**
   * サーバーから変更をプル
   * - since以降に更新されたデータを取得
   * - ユーザーがアクセス可能なグループのデータのみ
   */
  pull: protectedProcedure
    .input(syncPullInputSchema)
    .query(async ({ input, ctx }) => {
      // ユーザーが所属するグループを取得
      const userGroups = await groupRepository.findByUserId(ctx.userId)
      const accessibleGroupIds = userGroups.map((g) => g.id)

      // groupIdsパラメータがあればそれでフィルタ
      const targetGroupIds = input.groupIds
        ? input.groupIds.filter((id) => accessibleGroupIds.includes(id))
        : accessibleGroupIds

      // 変更されたエンティティを取得
      const changes = await syncRepository.getChangedEntities(
        targetGroupIds,
        input.since
      )

      return {
        items: changes.items,
        tags: changes.tags,
        lists: changes.lists,
        listItems: changes.listItems,
        history: changes.history,
        syncedAt: new Date(),
      }
    }),

  /**
   * 初回ログイン時のローカルデータマージ
   * - ローカルデータをサーバーにアップロード
   * - IDの重複があればマッピングを返す
   * - サーバーのデータを返す
   */
  merge: protectedProcedure
    .input(syncMergeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { data } = input

      // 型アサーション用のヘルパー
      type RawItem = { id?: string; name?: string; quantity?: number; memo?: string | null; tagIds?: string[]; purchasedAt?: string | null; createdAt?: string }
      type RawTag = { id?: string; name?: string; createdAt?: string }
      type RawList = { id?: string; name?: string; status?: string; createdAt?: string; completedAt?: string | null }
      type RawListItem = { id?: string; listId?: string; name?: string; quantity?: number; memo?: string | null; tagIds?: string[]; checked?: boolean; createdAt?: string }
      type RawHistory = { id?: string; listId?: string; location?: string | null; purchasedAt?: string }

      // DataMergeServiceを使用してデータをマージ
      const mergeResult = await dataMergeService.merge(ctx.userId, {
        items: (data.items as RawItem[]).map((item) => ({
          id: item.id ?? "",
          name: item.name ?? "",
          quantity: item.quantity ?? 1,
          memo: item.memo,
          tagIds: item.tagIds ?? [],
          purchasedAt: item.purchasedAt ? new Date(item.purchasedAt) : null,
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        })),
        tags: (data.tags as RawTag[]).map((tag) => ({
          id: tag.id ?? "",
          name: tag.name ?? "",
          createdAt: tag.createdAt ? new Date(tag.createdAt) : new Date(),
        })),
        lists: (data.lists as RawList[]).map((list) => ({
          id: list.id ?? "",
          name: list.name ?? "",
          status: (list.status ?? "in_progress") as "in_progress" | "completed",
          createdAt: list.createdAt ? new Date(list.createdAt) : new Date(),
          completedAt: list.completedAt ? new Date(list.completedAt) : null,
        })),
        listItems: (data.listItems as RawListItem[]).map((listItem) => ({
          id: listItem.id ?? "",
          listId: listItem.listId ?? "",
          name: listItem.name ?? "",
          quantity: listItem.quantity ?? 1,
          memo: listItem.memo,
          tagIds: listItem.tagIds ?? [],
          checked: listItem.checked ?? false,
          createdAt: listItem.createdAt ? new Date(listItem.createdAt) : new Date(),
        })),
        history: (data.history as RawHistory[]).map((history) => ({
          id: history.id ?? "",
          listId: history.listId ?? "",
          location: history.location,
          purchasedAt: history.purchasedAt ? new Date(history.purchasedAt) : new Date(),
        })),
      })

      if (!mergeResult.success && mergeResult.errors.length > 0) {
        console.error("Merge errors:", mergeResult.errors)
      }

      // ユーザーのグループを取得
      const userGroups = await groupRepository.findByUserId(ctx.userId)

      // サーバーデータを取得して返す
      const serverChanges = await syncRepository.getChangedEntities(
        userGroups.map((g) => g.id)
      )

      return {
        idMappings: [] as Array<{ entity: string; localId: string; serverId: string }>,
        serverData: {
          items: serverChanges.items,
          tags: serverChanges.tags,
          lists: serverChanges.lists,
          listItems: serverChanges.listItems,
          history: serverChanges.history,
          syncedAt: new Date(),
        },
        mergeResult: {
          success: mergeResult.success,
          mergedCounts: mergeResult.mergedCounts,
          errors: mergeResult.errors,
        },
      }
    }),

  /**
   * 同期状態を取得
   * - 未同期操作数など
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const pendingCount = await syncRepository.countPendingOperations(ctx.userId)

    return {
      pendingCount,
      lastSyncAt: null as Date | null, // TODO: 実装
    }
  }),
})
