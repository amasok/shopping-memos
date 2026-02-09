"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db, type ShoppingItem } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

interface UseItemsOptions {
  groupId?: string
  tagIds?: string[]
  includePurchased?: boolean
  purchasedOnly?: boolean
}

/**
 * アイテム一覧を取得するフック
 * グループ選択時: サーバーから取得
 * 個人モード: ローカルDBから取得
 *
 * 返り値は常にShoppingItem型（tagIds配列を持つ）に正規化される
 */
export function useItems(options: UseItemsOptions = {}) {
  const { groupId, tagIds, includePurchased = false, purchasedOnly = false } = options
  const { useServer, isAuthLoading, selectedGroupId } = useDataSource()

  // 実際に使用するgroupId
  // 明示的にgroupIdが渡された場合（undefinedでも）はそれを使用
  // 渡されていない場合はコンテキストのselectedGroupIdを使用
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // ローカル（Dexie）クエリ
  const localItems = useLiveQuery(
    async () => {
      if (useServer) return undefined // サーバー使用時は実行しない

      // 進行中のリストに含まれるアイテム名を取得（除外用）
      const activeLists = await db.lists
        .filter((list) => list.status === "in_progress" && list.groupId === effectiveGroupId)
        .toArray()
      const activeListIds = activeLists.map((list) => list.id)

      const activeListItems = await db.listItems
        .filter((item) => activeListIds.includes(item.listId))
        .toArray()
      const namesInActiveLists = new Set(activeListItems.map((item) => item.name))

      const query = db.items.orderBy("createdAt").reverse()

      const filtered = await query.filter((item) => {
        // グループフィルタ
        if (item.groupId !== effectiveGroupId) return false
        // 購入済みのみフィルタ
        if (purchasedOnly && !item.purchasedAt) return false
        // 購入済み除外フィルタ
        if (!includePurchased && !purchasedOnly && item.purchasedAt) return false
        // タグフィルタ
        if (tagIds && tagIds.length > 0) {
          if (!tagIds.some((tagId) => item.tagIds.includes(tagId))) return false
        }
        // 進行中リストに含まれるアイテムを除外
        if (namesInActiveLists.has(item.name)) return false
        return true
      }).toArray()

      return filtered
    },
    [useServer, effectiveGroupId, tagIds, includePurchased, purchasedOnly]
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
    isLoading: localItems === undefined || isAuthLoading,
    error: null,
    refetch: async () => {}, // Dexieはリアクティブなのでrefetch不要
  }
}
