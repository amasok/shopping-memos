"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

interface UseItemsOptions {
  groupId?: string
  tagIds?: string[]
  includePurchased?: boolean
}

/**
 * アイテム一覧を取得するフック
 * ログイン時: サーバーから取得
 * 未ログイン時: ローカルDBから取得
 */
export function useItems(options: UseItemsOptions = {}) {
  const { groupId, tagIds, includePurchased = false } = options
  const { useServer, isAuthLoading } = useDataSource()

  // ローカル（Dexie）クエリ
  const localItems = useLiveQuery(
    async () => {
      if (useServer) return undefined // サーバー使用時は実行しない

      const query = db.items.orderBy("createdAt").reverse()

      const filtered = await query.filter((item) => {
        // グループフィルタ
        if (item.groupId !== groupId) return false
        // 購入済みフィルタ
        if (!includePurchased && item.purchasedAt) return false
        // タグフィルタ
        if (tagIds && tagIds.length > 0) {
          if (!tagIds.some((tagId) => item.tagIds.includes(tagId))) return false
        }
        return true
      }).toArray()

      return filtered
    },
    [useServer, groupId, tagIds, includePurchased]
  )

  // サーバー（tRPC）クエリ
  const serverQuery = trpc.catalog.getItems.useQuery(
    {
      groupId,
      tagIds,
      includePurchased,
    },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    return {
      items: serverQuery.data ?? [],
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    items: localItems ?? [],
    isLoading: localItems === undefined || isAuthLoading,
    error: null,
    refetch: async () => {}, // Dexieはリアクティブなのでrefetch不要
  }
}
