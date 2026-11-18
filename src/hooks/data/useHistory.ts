"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { trpc } from "@/infrastructure/trpc/client"
import { useCatalogSource } from "./useCatalogSource"
import { queryHistory, type PurchaseHistoryWithItems } from "./shoppingQueries"

export type { PurchaseHistoryWithItems } from "./shoppingQueries"

interface UseHistoryOptions {
  groupId?: string
  limit?: number
  offset?: number
}

/**
 * 購入履歴一覧を取得するフック（#62 O8）
 * - ゲスト: ゲスト DB から
 * - ログイン中・フラグ false: サーバー（tRPC）から
 * - ログイン中・フラグ true: ユーザー DB から（初回の同期が終わるまでは読み込み中）
 *
 * 購入履歴 = purchasedAtが入っているリスト（購入日時の新しい順）
 */
export function useHistory(options: UseHistoryOptions = {}) {
  const { groupId, limit, offset } = options
  const { mode, store, awaitingFirstSync, isAuthLoading, selectedGroupId } = useCatalogSource()
  const useServer = mode === "server"

  // 実際に使用するgroupId
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // 端末の DB（ゲスト DB・ユーザー DB）のクエリ
  const localHistory = useLiveQuery(
    async () => {
      if (!store) return undefined
      return queryHistory(store.db, { groupId: effectiveGroupId, limit, offset })
    },
    [store, effectiveGroupId, limit, offset]
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
    isLoading: localHistory === undefined || awaitingFirstSync || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}

