"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

interface UseListsOptions {
  groupId?: string
  status?: "in_progress" | "completed"
  includeCompleted?: boolean
  /** trueの場合、groupIdフィルタを無視して全リストを返す */
  includeAllGroups?: boolean
}

/**
 * 買い物リスト一覧を取得するフック
 * グループ選択時: サーバーから取得
 * 個人モード: ローカルDBから取得
 */
export function useLists(options: UseListsOptions = {}) {
  const { groupId, status, includeCompleted = false, includeAllGroups = false } = options
  const { useServer, isAuthLoading, selectedGroupId } = useDataSource()

  // 実際に使用するgroupId
  // 明示的にgroupIdが渡された場合（undefinedでも）はそれを使用
  // 渡されていない場合はコンテキストのselectedGroupIdを使用
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // ローカル（Dexie）クエリ
  const localLists = useLiveQuery(
    async () => {
      if (useServer) return undefined

      const filtered = await db.lists.filter((list) => {
        // グループフィルタ（includeAllGroups時はスキップ）
        if (!includeAllGroups && list.groupId !== effectiveGroupId) return false
        // ステータスフィルタ
        if (status && list.status !== status) return false
        // 完了済み除外
        if (!includeCompleted && list.status === "completed") return false
        return true
      }).toArray()

      return filtered
    },
    [useServer, effectiveGroupId, status, includeCompleted, includeAllGroups]
  )

  // サーバー（tRPC）クエリ
  // effectiveGroupId が undefined の場合は null を送信（個人モード）
  const serverQuery = trpc.shopping.getLists.useQuery(
    {
      groupId: effectiveGroupId ?? null,
      status,
      includeCompleted,
      includeAllGroups,
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

interface UseListsWithItemsOptions {
  groupId?: string
  status?: "in_progress" | "completed"
  includeCompleted?: boolean
}

/**
 * 買い物リスト一覧とリストアイテムを取得するフック
 * ホームページでリスト内のアイテムを表示するために使用
 */
export function useListsWithItems(options: UseListsWithItemsOptions = {}) {
  const { status, includeCompleted = false } = options
  const { useServer, isAuthLoading, selectedGroupId } = useDataSource()

  // 実際に使用するgroupId
  const effectiveGroupId = "groupId" in options ? options.groupId : selectedGroupId

  // ローカル（Dexie）クエリ - リスト
  const localLists = useLiveQuery(
    async () => {
      if (useServer) return undefined

      const filtered = await db.lists.filter((list) => {
        if (list.groupId !== effectiveGroupId) return false
        if (status && list.status !== status) return false
        if (!includeCompleted && list.status === "completed") return false
        return true
      }).toArray()

      return filtered
    },
    [useServer, effectiveGroupId, status, includeCompleted]
  )

  // ローカル（Dexie）クエリ - リストアイテム（該当グループのリストに紐づくもの）
  const localListItems = useLiveQuery(
    async () => {
      if (useServer) return undefined
      if (!localLists) return undefined

      const listIds = localLists.map((list) => list.id)
      if (listIds.length === 0) return []

      return db.listItems.filter((item) => listIds.includes(item.listId)).toArray()
    },
    [useServer, localLists]
  )

  // サーバー（tRPC）クエリ
  // effectiveGroupId が undefined の場合は null を送信（個人モード）
  const serverQuery = trpc.shopping.getLists.useQuery(
    {
      groupId: effectiveGroupId ?? null,
      status,
      includeCompleted,
    },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    // サーバーモードでは lists.data.items からアイテムを取得
    const allListItems = (serverQuery.data ?? []).flatMap((list) => list.items ?? [])
    return {
      lists: serverQuery.data ?? [],
      listItems: allListItems,
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    lists: localLists ?? [],
    listItems: localListItems ?? [],
    isLoading: localLists === undefined || localListItems === undefined || isAuthLoading,
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
