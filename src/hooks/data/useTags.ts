"use client"

import { useLiveQuery } from "dexie-react-hooks"
import type { Tag } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useCatalogSource } from "./useCatalogSource"
import { queryTags } from "./catalogQueries"

interface UseTagsOptions {
  groupId?: string
}

/**
 * タグ一覧を取得するフック（#62 O7）
 * - ゲスト: ゲスト DB から（今のまま並べ替えない）
 * - ログイン中・フラグ false: サーバー（tRPC）から
 * - ログイン中・フラグ true: ユーザー DB から（名前の文字コードの順。初回の同期が終わるまでは読み込み中）
 *
 * 返り値は常にTag型（groupId?: string）に正規化される
 */
export function useTags(options: UseTagsOptions = {}) {
  const { groupId } = options
  const { mode, store, awaitingFirstSync, isAuthLoading, selectedGroupId } = useCatalogSource()
  const useServer = mode === "server"

  // 実際に使用するgroupId
  // 明示的にgroupIdが渡された場合（undefinedでも）はそれを使用
  // 渡されていない場合はコンテキストのselectedGroupIdを使用
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // 端末の DB（ゲスト DB・ユーザー DB）のクエリ
  const localTags = useLiveQuery(
    async () => {
      if (!store) return undefined
      return queryTags(store.db, { groupId: effectiveGroupId, order: mode === "local" ? "server" : "guest" })
    },
    [store, mode, effectiveGroupId]
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
    isLoading: localTags === undefined || awaitingFirstSync || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}
