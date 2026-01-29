"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db, type PurchaseHistory, type ListItem } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

/**
 * 履歴にlistItemsを付与した型
 */
export interface PurchaseHistoryWithItems extends PurchaseHistory {
  listItems: ListItem[]
}

interface UseHistoryOptions {
  groupId?: string
  limit?: number
  offset?: number
}

/**
 * 購入履歴一覧を取得するフック
 * グループ選択時: サーバーから取得
 * 個人モード: ローカルDBから取得
 *
 * 返り値は常にPurchaseHistoryWithItems型に正規化される（listItems付き）
 */
export function useHistory(options: UseHistoryOptions = {}) {
  const { groupId, limit, offset } = options
  const { useServer, isAuthLoading, selectedGroupId } = useDataSource()

  // 実際に使用するgroupId
  // 明示的にgroupIdが渡された場合（undefinedでも）はそれを使用
  // 渡されていない場合はコンテキストのselectedGroupIdを使用
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // ローカル（Dexie）クエリ - listItems付きで取得
  const localHistory = useLiveQuery(
    async () => {
      if (useServer) return undefined

      const query = db.history.filter((h) => h.groupId === effectiveGroupId)
      const sorted = await query.reverse().sortBy("purchasedAt")

      // ページネーション
      let result = sorted
      if (offset) {
        result = result.slice(offset)
      }
      if (limit) {
        result = result.slice(0, limit)
      }

      // 各履歴にlistItemsを付与
      const historyWithItems: PurchaseHistoryWithItems[] = await Promise.all(
        result.map(async (h) => {
          // itemIdsに含まれるlistItemsを取得
          const listItems = await db.listItems
            .where("id")
            .anyOf(h.itemIds ?? [])
            .toArray()

          return {
            ...h,
            listItems,
          }
        })
      )

      return historyWithItems
    },
    [useServer, effectiveGroupId, limit, offset]
  )

  // サーバー（tRPC）クエリ
  // effectiveGroupId が undefined の場合は null を送信（個人モード）
  const serverQuery = trpc.shopping.getHistory.useQuery(
    {
      groupId: effectiveGroupId ?? null,
      limit,
      offset,
    },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    // サーバーから取得した履歴をPurchaseHistoryWithItems型に変換
    const normalizedHistory: PurchaseHistoryWithItems[] = (serverQuery.data ?? []).map((h) => ({
      id: h.id,
      listId: h.listId,
      location: h.location ?? undefined,
      itemIds: h.itemIds ?? [],
      groupId: h.groupId ?? undefined,
      purchasedAt: h.purchasedAt,
      // サーバーからはlistItemsが返される
      listItems: (h.listItems ?? []).map((item) => ({
        id: item.id,
        listId: item.listId,
        name: item.name,
        quantity: item.quantity,
        memo: item.memo ?? undefined,
        tagIds: item.tagIds ?? [],
        checked: item.checked,
        createdAt: item.createdAt,
        groupId: item.groupId ?? undefined,
      })),
    }))

    return {
      history: normalizedHistory,
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
