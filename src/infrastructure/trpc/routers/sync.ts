import { TRPCError } from "@trpc/server"
import { router, protectedProcedure } from "../server"
import {
  syncPushInputSchema,
  syncPullInputSchema,
  syncMergeInputSchema,
  parseMergeData,
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
          // アクセス権確認
          // 他人・他グループのエンティティへの操作は記録せず破棄する（競合データも返さない）
          const access = await syncRepository.checkEntityAccess(
            op.entity,
            op.entityId,
            ctx.userId
          )
          if (access === "denied") {
            console.warn(`Sync operation rejected (forbidden): ${op.id}`)
            processedIds.push(op.id)
            continue
          }

          // サーバー側の最新状態を確認
          // サーバーに存在しない（削除済み等）エンティティは所有者を判定できないため、
          // 自分自身の操作ログのみを競合判定に使う
          const serverState = await syncRepository.findLatestEntityState(
            op.entity,
            op.entityId,
            access === "not_found" ? { userId: ctx.userId } : undefined
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

      // 入力は Zod で検証・変換する（型キャストや ?? による補完はしない）
      // 形式が不正な要素は 1 件ずつスキップし、ほかのデータは取り込む
      const { data: validData, errors: validationErrors } = parseMergeData(data)
      const serviceResult = await dataMergeService.merge(ctx.userId, validData)
      // トランザクション全体が失敗したときは何も取り込まれていない。
      // 完了扱いにせず、クライアントに再試行させる（#116）
      if (serviceResult.fatal) {
        console.error("Merge failed:", serviceResult.errors)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "マージに失敗しました" })
      }
      const mergeResult = {
        ...serviceResult,
        success: serviceResult.success && validationErrors.length === 0,
        errors: [...validationErrors, ...serviceResult.errors],
      }
      // 取り込めなかった件数（#116）: 検証でスキップした件数（1 件につき 1 つのエラー）と、
      // レコード単位の失敗だけを数える。タグの関連付けのスキップや、取り込み済みの送り直しは数えない
      const notImportedCount = validationErrors.length + serviceResult.failedCount

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
        // ID を付け替えたタグ。クライアントは、後から送る分の tagIds をこれで付け替える
        idMappings: serviceResult.idMappings,
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
          notImportedCount,
          alreadyMergedCount: serviceResult.alreadyMergedCount,
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
