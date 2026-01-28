"use client"

import { useCallback } from "react"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

/**
 * 購入履歴の操作フック
 * ログイン時: サーバーAPI経由
 * 未ログイン時: ローカルDB直接操作
 */
export function useHistoryMutations() {
  const { useServer } = useDataSource()
  const utils = trpc.useUtils()

  // サーバー側ミューテーション
  const revertMutation = trpc.shopping.revertHistory.useMutation({
    onSuccess: () => {
      utils.shopping.getHistory.invalidate()
      utils.catalog.getItems.invalidate()
    },
  })
  const deleteMutation = trpc.shopping.deleteHistory.useMutation({
    onSuccess: () => {
      utils.shopping.getHistory.invalidate()
    },
  })

  // 履歴からアイテムを戻す
  const revertHistory = useCallback(
    async (historyId: string, itemIds: string[]) => {
      if (useServer) {
        return revertMutation.mutateAsync({ historyId, itemIds })
      }

      // ローカル処理
      const history = await db.history.get(historyId)
      if (!history) throw new Error("履歴が見つかりません")

      // 指定されたアイテムのpurchasedAtをundefinedに戻す
      const revertedItemIds: string[] = []
      for (const itemId of itemIds) {
        if (!history.itemIds?.includes(itemId)) continue

        // リストアイテムからカタログアイテムを特定して戻す
        const listItem = await db.listItems.get(itemId)
        if (listItem) {
          // 名前でマッチング
          const items = await db.items
            .filter((item) => item.name === listItem.name && !!item.purchasedAt)
            .toArray()
          for (const item of items) {
            await db.items.update(item.id, { purchasedAt: undefined })
            revertedItemIds.push(item.id)
          }
        }
      }

      return {
        success: true,
        revertedItemIds,
      }
    },
    [useServer, revertMutation]
  )

  // 履歴を削除
  const deleteHistory = useCallback(
    async (historyId: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id: historyId })
      }

      await db.history.delete(historyId)
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
