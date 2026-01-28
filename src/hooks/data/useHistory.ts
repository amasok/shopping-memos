"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

interface UseHistoryOptions {
  groupId?: string
  limit?: number
  offset?: number
}

/**
 * 購入履歴一覧を取得するフック
 * ログイン時: サーバーから取得
 * 未ログイン時: ローカルDBから取得
 */
export function useHistory(options: UseHistoryOptions = {}) {
  const { groupId, limit, offset } = options
  const { useServer, isAuthLoading } = useDataSource()

  // ローカル（Dexie）クエリ
  const localHistory = useLiveQuery(
    async () => {
      if (useServer) return undefined

      const query = db.history.filter((h) => h.groupId === groupId)
      const sorted = await query.reverse().sortBy("purchasedAt")

      // ページネーション
      let result = sorted
      if (offset) {
        result = result.slice(offset)
      }
      if (limit) {
        result = result.slice(0, limit)
      }

      return result
    },
    [useServer, groupId, limit, offset]
  )

  // サーバー（tRPC）クエリ
  const serverQuery = trpc.shopping.getHistory.useQuery(
    {
      groupId,
      limit,
      offset,
    },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    return {
      history: serverQuery.data ?? [],
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    history: localHistory ?? [],
    isLoading: localHistory === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}

interface UseHistoryByIdOptions {
  historyId: string
}

/**
 * 購入履歴詳細を取得するフック
 */
export function useHistoryById(options: UseHistoryByIdOptions) {
  const { historyId } = options
  const { useServer, isAuthLoading } = useDataSource()

  // ローカル（Dexie）クエリ
  const localHistoryItem = useLiveQuery(
    async () => {
      if (useServer) return undefined
      return db.history.get(historyId)
    },
    [useServer, historyId]
  )

  // サーバー（tRPC）クエリ
  const serverQuery = trpc.shopping.getHistoryById.useQuery(
    { id: historyId },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    return {
      historyItem: serverQuery.data ?? null,
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    historyItem: localHistoryItem ?? null,
    isLoading: localHistoryItem === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}
