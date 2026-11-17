"use client"

import { useCallback } from "react"
import { trpc } from "@/infrastructure/trpc/client"
import * as shoppingRepository from "@/infrastructure/local/shoppingRepository"
import { requireStore, useCatalogSource } from "./useCatalogSource"

/**
 * 購入履歴の操作フック（#62 O8）
 * - ログイン中・フラグ false: サーバーAPI経由
 * - ゲスト・ログイン中でフラグ true: 端末の DB のリポジトリ経由
 *
 * 購入履歴 = purchasedAtが入っているリスト
 */
export function useHistoryMutations() {
  const source = useCatalogSource()
  const useServer = source.mode === "server"
  const utils = trpc.useUtils()
  // サーバーファーストで、カタログの一覧のキャッシュを無効にする（ゲスト・ローカルファーストでは何もしない。#62 O8）
  const { refreshCatalog } = source

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

      const { revertedItemIds } = await shoppingRepository.revertHistory(requireStore(source), historyId)
      source.afterWrite()
      return { success: true, revertedItemIds }
    },
    [useServer, revertMutation, source]
  )

  // 履歴を削除（リストとアイテムも削除）
  const deleteHistory = useCallback(
    async (historyId: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id: historyId })
      }

      await shoppingRepository.deleteHistory(requireStore(source), historyId)
      source.afterWrite()
      return { success: true }
    },
    [useServer, deleteMutation, source]
  )

  return {
    revertHistory,
    deleteHistory,
    isReverting: revertMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
