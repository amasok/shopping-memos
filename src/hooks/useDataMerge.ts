"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"

const MERGE_COMPLETED_KEY = "data-merge-completed"

interface MergeStatus {
  isMerging: boolean
  isCompleted: boolean
  error: string | null
  mergedCounts: {
    items: number
    tags: number
    lists: number
    listItems: number
    history: number
  } | null
}

/**
 * ログイン時にローカルデータをサーバーにマージするフック
 * - 初回ログイン時のみ実行
 * - IndexedDB のデータを PostgreSQL に移行
 */
export function useDataMerge() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [status, setStatus] = useState<MergeStatus>({
    isMerging: false,
    isCompleted: false,
    error: null,
    mergedCounts: null,
  })
  const mergeAttempted = useRef(false)

  const mergeMutation = trpc.sync.merge.useMutation()

  const executeMerge = useCallback(async () => {
    if (!user) return

    // マージ済みかチェック（ユーザーIDごとに管理）
    const mergeKey = `${MERGE_COMPLETED_KEY}-${user.id}`
    const alreadyMerged = localStorage.getItem(mergeKey) === "true"
    if (alreadyMerged) {
      setStatus((prev) => ({ ...prev, isCompleted: true }))
      return
    }

    setStatus((prev) => ({ ...prev, isMerging: true, error: null }))

    try {
      // IndexedDB からすべてのデータを取得
      const [localItems, localTags, localLists, localListItems, localHistory] =
        await Promise.all([
          db.items.toArray(),
          db.tags.toArray(),
          db.lists.toArray(),
          db.listItems.toArray(),
          db.history.toArray(),
        ])

      // ローカルにデータがなければマージ不要
      if (
        localItems.length === 0 &&
        localTags.length === 0 &&
        localLists.length === 0 &&
        localListItems.length === 0 &&
        localHistory.length === 0
      ) {
        localStorage.setItem(mergeKey, "true")
        setStatus({
          isMerging: false,
          isCompleted: true,
          error: null,
          mergedCounts: { items: 0, tags: 0, lists: 0, listItems: 0, history: 0 },
        })
        return
      }

      // サーバーにマージ
      const result = await mergeMutation.mutateAsync({
        data: {
          items: localItems.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            memo: item.memo ?? null,
            tagIds: item.tagIds,
            purchasedAt: item.purchasedAt?.toISOString() ?? null,
            createdAt: item.createdAt.toISOString(),
          })),
          tags: localTags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            createdAt: tag.createdAt.toISOString(),
          })),
          lists: localLists.map((list) => ({
            id: list.id,
            name: list.name,
            status: list.status,
            createdAt: list.createdAt.toISOString(),
            completedAt: list.completedAt?.toISOString() ?? null,
          })),
          listItems: localListItems.map((listItem) => ({
            id: listItem.id,
            listId: listItem.listId,
            name: listItem.name,
            quantity: listItem.quantity,
            memo: listItem.memo ?? null,
            tagIds: listItem.tagIds,
            checked: listItem.checked,
            createdAt: listItem.createdAt.toISOString(),
          })),
          history: localHistory.map((history) => ({
            id: history.id,
            listId: history.listId,
            location: history.location ?? null,
            itemIds: history.itemIds,
            purchasedAt: history.purchasedAt.toISOString(),
          })),
        },
      })

      // マージ完了をマーク
      localStorage.setItem(mergeKey, "true")

      setStatus({
        isMerging: false,
        isCompleted: true,
        error: null,
        mergedCounts: result.mergeResult?.mergedCounts ?? null,
      })

      console.log("Data merge completed:", result.mergeResult)
    } catch (error) {
      console.error("Data merge failed:", error)
      setStatus((prev) => ({
        ...prev,
        isMerging: false,
        error: error instanceof Error ? error.message : "マージに失敗しました",
      }))
    }
  }, [user, mergeMutation])

  // ログイン後に自動でマージを実行
  useEffect(() => {
    if (isAuthLoading || !user || mergeAttempted.current) return

    mergeAttempted.current = true
    executeMerge()
  }, [isAuthLoading, user, executeMerge])

  // マージをリトライする関数
  const retryMerge = useCallback(() => {
    if (user) {
      const mergeKey = `${MERGE_COMPLETED_KEY}-${user.id}`
      localStorage.removeItem(mergeKey)
      mergeAttempted.current = false
      executeMerge()
    }
  }, [user, executeMerge])

  return {
    ...status,
    retryMerge,
  }
}
