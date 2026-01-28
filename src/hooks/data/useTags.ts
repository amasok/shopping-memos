"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

interface UseTagsOptions {
  groupId?: string
}

/**
 * タグ一覧を取得するフック
 * ログイン時: サーバーから取得
 * 未ログイン時: ローカルDBから取得
 */
export function useTags(options: UseTagsOptions = {}) {
  const { groupId } = options
  const { useServer, isAuthLoading } = useDataSource()

  // ローカル（Dexie）クエリ
  const localTags = useLiveQuery(
    async () => {
      if (useServer) return undefined

      // グループ選択時: そのグループのタグ + 個人タグ
      // 個人モード時: 個人タグのみ
      const filtered = await db.tags.filter((tag) => {
        return tag.groupId === groupId || (groupId !== undefined && tag.groupId === undefined)
      }).toArray()

      return filtered
    },
    [useServer, groupId]
  )

  // サーバー（tRPC）クエリ
  const serverQuery = trpc.catalog.getTags.useQuery(
    { groupId },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    return {
      tags: serverQuery.data ?? [],
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    tags: localTags ?? [],
    isLoading: localTags === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}
