"use client"

import { useLiveQuery } from "dexie-react-hooks"
import type { ShoppingItem } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useCatalogSource } from "./useCatalogSource"
import { queryItems } from "./catalogQueries"

interface UseItemsOptions {
  groupId?: string
  tagIds?: string[]
  includePurchased?: boolean
  purchasedOnly?: boolean
}

/**
 * アイテム一覧を取得するフック（#62 O7）
 * - ゲスト: ゲスト DB から（今の並び）
 * - ログイン中・フラグ false: サーバー（tRPC）から
 * - ログイン中・フラグ true: ユーザー DB から（サーバーと同じ並び。初回の同期が終わるまでは読み込み中）
 *
 * 返り値は常にShoppingItem型（tagIds配列を持つ）に正規化される
 */
export function useItems(options: UseItemsOptions = {}) {
  const { groupId, tagIds, includePurchased = false, purchasedOnly = false } = options
  const source = useCatalogSource()
  const { mode, store, awaitingFirstSync, isAuthLoading, selectedGroupId } = source
  const useServer = mode === "server"

  // 実際に使用するgroupId
  // 明示的にgroupIdが渡された場合（undefinedでも）はそれを使用
  // 渡されていない場合はコンテキストのselectedGroupIdを使用
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId
  const tagKey = tagIds?.join(",") ?? ""

  // 端末の DB（ゲスト DB・ユーザー DB）のクエリ
  const localItems = useLiveQuery(
    async () => {
      if (!store) return undefined
      return queryItems(store.db, {
        groupId: effectiveGroupId,
        tagIds,
        includePurchased,
        purchasedOnly,
        order: mode === "local" ? "server" : "guest",
      })
    },
    // tagIds は内容（tagKey）で比べる（配列は描画ごとに別のものになるため）
    [store, mode, effectiveGroupId, tagKey, includePurchased, purchasedOnly]
  )

  // サーバー（tRPC）クエリ
  // effectiveGroupId が undefined の場合は null を送信（個人モード）
  const serverQuery = trpc.catalog.getItems.useQuery(
    {
      groupId: effectiveGroupId ?? null,
      tagIds,
      includePurchased: includePurchased || purchasedOnly,
    },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    // サーバーから取得したアイテムをShoppingItem型に変換
    // ItemWithTags (tags: {id, name}[]) → ShoppingItem (tagIds: string[])
    let serverItems = serverQuery.data ?? []
    if (purchasedOnly) {
      serverItems = serverItems.filter((item) => !!item.purchasedAt)
    } else if (!includePurchased) {
      serverItems = serverItems.filter((item) => !item.purchasedAt)
    }

    // tags配列をtagIds配列に変換
    const normalizedItems: ShoppingItem[] = serverItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      memo: item.memo ?? undefined,
      tagIds: item.tags.map((tag) => tag.id),
      groupId: item.groupId ?? undefined,
      purchasedAt: item.purchasedAt ?? undefined,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))

    return {
      items: normalizedItems,
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    items: localItems ?? [],
    isLoading: localItems === undefined || awaitingFirstSync || isAuthLoading,
    error: null,
    refetch: async () => {}, // Dexieはリアクティブなのでrefetch不要
  }
}
