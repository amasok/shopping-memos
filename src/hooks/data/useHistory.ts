"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db, type ShoppingList, type ListItem } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

/**
 * 購入履歴（purchasedAtが入っているリスト）にlistItemsを付与した型
 */
export interface PurchaseHistoryWithItems extends ShoppingList {
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
 * 購入履歴 = purchasedAtが入っているリスト
 */
export function useHistory(options: UseHistoryOptions = {}) {
  const { groupId, limit, offset } = options
  const { useServer, isAuthLoading, selectedGroupId } = useDataSource()

  // 実際に使用するgroupId
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // ローカル（Dexie）クエリ - purchasedAtが入っているリストを取得
  const localHistory = useLiveQuery(
    async () => {
      if (useServer) return undefined

      // purchasedAtが入っているリストを取得
      const lists = await db.lists
        .filter((list) => list.groupId === effectiveGroupId && !!list.purchasedAt)
        .toArray()

      // purchasedAtで降順ソート
      const sorted = lists.sort((a, b) => {
        const dateA = a.purchasedAt?.getTime() ?? 0
        const dateB = b.purchasedAt?.getTime() ?? 0
        return dateB - dateA
      })

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
        result.map(async (list) => {
          const listItems = await db.listItems
            .where("listId")
            .equals(list.id)
            .toArray()

          return {
            ...list,
            listItems,
          }
        })
      )

      return historyWithItems
    },
    [useServer, effectiveGroupId, limit, offset]
  )

  // サーバー（tRPC）クエリ
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
      name: h.name,
      status: h.status as "in_progress" | "completed",
      groupId: h.groupId ?? undefined,
      createdAt: h.createdAt,
      completedAt: h.completedAt ?? undefined,
      purchasedAt: h.purchasedAt ?? undefined,
      location: h.location ?? undefined,
      listItems: (h.items ?? []).map((item) => ({
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
      const list = await db.lists.get(historyId)
      // purchasedAtが入っているリストのみ履歴として返す
      if (list && list.purchasedAt) {
        return list
      }
      return null
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
