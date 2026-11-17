"use client"

import { useCallback } from "react"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"
import { useCatalogSource } from "./useCatalogSource"

/**
 * 購入履歴の操作フック
 * ログイン時: サーバーAPI経由
 * 未ログイン時: ローカルDB直接操作
 *
 * 購入履歴 = purchasedAtが入っているリスト
 */
export function useHistoryMutations() {
  const { useServer } = useDataSource()
  const utils = trpc.useUtils()
  // カタログの一覧を追いつかせる（フラグ false: キャッシュを無効に / フラグ true: すぐに同期。#62 O7）
  const { refreshCatalog } = useCatalogSource()

  // サーバー側ミューテーション
  const revertMutation = trpc.shopping.revertHistory.useMutation({
    onSuccess: () => {
      utils.shopping.getHistory.invalidate()
      utils.shopping.getLists.invalidate()
      refreshCatalog()
    },
  })
  const deleteMutation = trpc.shopping.deleteHistory.useMutation({
    onSuccess: () => {
      utils.shopping.getHistory.invalidate()
      refreshCatalog()
    },
  })

  // 履歴からリストに戻す
  const revertHistory = useCallback(
    async (historyId: string) => {
      if (useServer) {
        return revertMutation.mutateAsync({ historyId })
      }

      // ローカル処理
      const list = await db.lists.get(historyId)
      if (!list) throw new Error("履歴が見つかりません")
      if (!list.purchasedAt) throw new Error("この履歴は既にリストに戻っています")

      // リストに含まれるアイテムを取得
      const listItems = await db.listItems.where("listId").equals(historyId).toArray()

      // 名前でマッチングして購入済みカタログアイテムを未購入に戻す
      const revertedItemIds: string[] = []
      for (const listItem of listItems) {
        const catalogItems = await db.items
          .filter((item) => item.name === listItem.name && !!item.purchasedAt)
          .toArray()

        for (const item of catalogItems) {
          await db.items.update(item.id, { purchasedAt: undefined })
          revertedItemIds.push(item.id)
        }
      }

      // リストを未購入に戻す
      await db.lists.update(historyId, {
        purchasedAt: undefined,
        location: undefined,
        status: "in_progress",
        completedAt: undefined,
      })

      return {
        success: true,
        revertedItemIds,
      }
    },
    [useServer, revertMutation]
  )

  // 履歴を削除（リストとアイテムも削除）
  const deleteHistory = useCallback(
    async (historyId: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id: historyId })
      }

      // ローカル処理
      const list = await db.lists.get(historyId)
      if (!list) throw new Error("履歴が見つかりません")

      // リストに含まれるアイテムを取得
      const listItems = await db.listItems.where("listId").equals(historyId).toArray()

      // 名前でマッチングしてカタログアイテムを削除
      for (const listItem of listItems) {
        const catalogItems = await db.items
          .filter((item) => item.name === listItem.name)
          .toArray()

        for (const item of catalogItems) {
          await db.items.delete(item.id)
        }
      }

      // リストアイテムを削除
      await db.listItems.where("listId").equals(historyId).delete()

      // リストを削除
      await db.lists.delete(historyId)

      return { success: true }
    },
    [useServer, deleteMutation]
  )

  return {
    revertHistory,
    deleteHistory,
    isReverting: revertMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
