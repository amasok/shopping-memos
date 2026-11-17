import { TRPCError } from "@trpc/server"
import { router, protectedProcedure } from "../server"
import {
  CLIENT_TOO_OLD,
  SUPPORTED_SYNC_PROTOCOL_VERSIONS,
  syncPushInputSchema,
  syncPullInputSchema,
  syncMergeInputSchema,
  parseMergeData,
  type NotImportedRecordRef,
} from "@/shared/schemas/sync"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import { groupRepository } from "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository"
import { dataMergeService } from "@/modules/sync/application/services/DataMergeService"
import { syncPushService } from "@/modules/sync/application/services/SyncPushService"

/**
 * Sync コンテキストのルーター
 * クライアント-サーバー間のデータ同期
 */
export const syncRouter = router({
  /**
   * ローカルの操作をサーバーの実データに反映する（#62 O4）
   * - 操作ごとに認可・検証し、フィールド単位の LWW と削除優先で適用する
   * - opId で冪等（再送は duplicate）
   * - 対応外の protocolVersion は CLIENT_TOO_OLD（クライアントは強制更新に進む）
   */
  push: protectedProcedure
    .input(syncPushInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (!SUPPORTED_SYNC_PROTOCOL_VERSIONS.includes(input.protocolVersion)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: CLIENT_TOO_OLD })
      }
      return syncPushService.push(ctx.userId, input.operations)
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
      const { data: validData, errors: validationErrors, skipped, requestIndexOf } = parseMergeData(data)
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
      // 取り込めなかったレコードの、リクエストの中での位置（#144）。クライアントは、これでゲストの DB に残すものを決める
      const notImported: NotImportedRecordRef[] = [
        ...skipped,
        ...serviceResult.failedRecords.map(({ entity, index }) => ({
          entity,
          requestIndex: requestIndexOf[entity][index],
        })),
      ]

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
          notImported,
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
