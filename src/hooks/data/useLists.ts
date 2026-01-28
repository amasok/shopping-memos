"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

interface UseListsOptions {
  groupId?: string
  status?: "in_progress" | "completed"
  includeCompleted?: boolean
}

/**
 * 買い物リスト一覧を取得するフック
 * ログイン時: サーバーから取得
 * 未ログイン時: ローカルDBから取得
 */
export function useLists(options: UseListsOptions = {}) {
  const { groupId, status, includeCompleted = false } = options
  const { useServer, isAuthLoading } = useDataSource()

  // ローカル（Dexie）クエリ
  const localLists = useLiveQuery(
    async () => {
      if (useServer) return undefined

      const filtered = await db.lists.filter((list) => {
        // グループフィルタ
        if (list.groupId !== groupId) return false
        // ステータスフィルタ
        if (status && list.status !== status) return false
        // 完了済み除外
        if (!includeCompleted && list.status === "completed") return false
        return true
      }).toArray()

      return filtered
    },
    [useServer, groupId, status, includeCompleted]
  )

  // サーバー（tRPC）クエリ
  const serverQuery = trpc.shopping.getLists.useQuery(
    {
      groupId,
      status,
      includeCompleted,
    },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    return {
      lists: serverQuery.data ?? [],
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    lists: localLists ?? [],
    isLoading: localLists === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}

interface UseListOptions {
  listId: string
}

/**
 * 買い物リスト詳細を取得するフック
 */
export function useList(options: UseListOptions) {
  const { listId } = options
  const { useServer, isAuthLoading } = useDataSource()

  // ローカル（Dexie）クエリ
  const localList = useLiveQuery(
    async () => {
      if (useServer) return undefined
      return db.lists.get(listId)
    },
    [useServer, listId]
  )

  const localListItems = useLiveQuery(
    async () => {
      if (useServer) return undefined
      return db.listItems.where("listId").equals(listId).toArray()
    },
    [useServer, listId]
  )

  // サーバー（tRPC）クエリ
  const serverQuery = trpc.shopping.getList.useQuery(
    { id: listId },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    return {
      list: serverQuery.data ?? null,
      items: serverQuery.data?.items ?? [],
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    list: localList ?? null,
    items: localListItems ?? [],
    isLoading: localList === undefined || localListItems === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}
