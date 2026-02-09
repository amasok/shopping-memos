"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db, type Tag } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

interface UseTagsOptions {
  groupId?: string
}

/**
 * タグ一覧を取得するフック
 * グループ選択時: サーバーから取得
 * 個人モード: ローカルDBから取得
 *
 * 返り値は常にTag型（groupId?: string）に正規化される
 */
export function useTags(options: UseTagsOptions = {}) {
  const { groupId } = options
  const { useServer, isAuthLoading, selectedGroupId } = useDataSource()

  // 実際に使用するgroupId
  // 明示的にgroupIdが渡された場合（undefinedでも）はそれを使用
  // 渡されていない場合はコンテキストのselectedGroupIdを使用
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // ローカル（Dexie）クエリ
  const localTags = useLiveQuery(
    async () => {
      if (useServer) return undefined

      // 選択されたグループのタグのみ取得
      const filtered = await db.tags.filter((tag) => {
        return tag.groupId === effectiveGroupId
      }).toArray()

      return filtered
    },
    [useServer, effectiveGroupId]
  )

  // サーバー（tRPC）クエリ
  // effectiveGroupId が undefined の場合は null を送信（個人モード）
  const serverQuery = trpc.catalog.getTags.useQuery(
    { groupId: effectiveGroupId ?? null },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    // サーバーから取得したタグをTag型に変換
    // サーバー: groupId: string | null → ローカル: groupId?: string
    const normalizedTags: Tag[] = (serverQuery.data ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      groupId: tag.groupId ?? undefined,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    }))

    return {
      tags: normalizedTags,
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
