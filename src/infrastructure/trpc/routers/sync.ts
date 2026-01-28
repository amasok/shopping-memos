import { TRPCError } from "@trpc/server"
import { router, protectedProcedure } from "../server"
import {
  syncPushInputSchema,
  syncPullInputSchema,
  syncMergeInputSchema,
} from "@/shared/schemas/sync"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import { groupRepository } from "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository"
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
      // ユーザーのデフォルトグループを取得（または作成）
      const userGroups = await groupRepository.findByUserId(ctx.userId)

      if (userGroups.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ユーザーにグループがありません。先にグループを作成してください。",
        })
      }

      const defaultGroupId = userGroups[0].id
      const idMappings: Array<{
        entity: string
        localId: string
        serverId: string
      }> = []

      // 各エンティティをマージ（簡易版: すべてサーバーにコピー）
      // 実際の実装では重複チェックと競合解決が必要
      const { data } = input

      // 操作をバッチで記録
      const operations = [
        ...data.items.map((item) => ({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          entity: "item" as const,
          entityId: (item as { id: string }).id,
          operation: "create" as const,
          payload: { ...item, groupId: defaultGroupId },
        })),
        ...data.tags.map((tag) => ({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          entity: "tag" as const,
          entityId: (tag as { id: string }).id,
          operation: "create" as const,
          payload: { ...tag, groupId: defaultGroupId },
        })),
        ...data.lists.map((list) => ({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          entity: "list" as const,
          entityId: (list as { id: string }).id,
          operation: "create" as const,
          payload: { ...list, groupId: defaultGroupId },
        })),
        ...data.listItems.map((listItem) => ({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          entity: "listItem" as const,
          entityId: (listItem as { id: string }).id,
          operation: "create" as const,
          payload: { ...listItem, groupId: defaultGroupId },
        })),
        ...data.history.map((history) => ({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          entity: "history" as const,
          entityId: (history as { id: string }).id,
          operation: "create" as const,
          payload: { ...history, groupId: defaultGroupId },
        })),
      ]

      if (operations.length > 0) {
        await syncRepository.createOperations(operations)
      }

      // サーバーデータを取得して返す
      const serverChanges = await syncRepository.getChangedEntities(
        userGroups.map((g) => g.id)
      )

      return {
        idMappings,
        serverData: {
          items: serverChanges.items,
          tags: serverChanges.tags,
          lists: serverChanges.lists,
          listItems: serverChanges.listItems,
          history: serverChanges.history,
          syncedAt: new Date(),
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
