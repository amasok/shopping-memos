"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { trpc } from "@/infrastructure/trpc/client"
import { useCatalogSource } from "./useCatalogSource"
import { queryListItems, queryLists } from "./shoppingQueries"

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
  const { mode, store, awaitingFirstSync, isAuthLoading, selectedGroupId } = useCatalogSource()
  const useServer = mode === "server"

  // 実際に使用するgroupId
  // 明示的にgroupIdが渡された場合（undefinedでも）はそれを使用
  // 渡されていない場合はコンテキストのselectedGroupIdを使用
  const effectiveGroupId = "groupId" in options ? groupId : selectedGroupId

  // ローカル（Dexie）クエリ
  const localLists = useLiveQuery(
    async () => {
      if (!store) return undefined
      return queryLists(store.db, { groupId: effectiveGroupId, status, includeCompleted, includeAllGroups })
    },
    [store, effectiveGroupId, status, includeCompleted, includeAllGroups]
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
    isLoading: localLists === undefined || awaitingFirstSync || isAuthLoading,
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
  const { mode, store, awaitingFirstSync, isAuthLoading, selectedGroupId } = useCatalogSource()
  const useServer = mode === "server"

  // 実際に使用するgroupId
  const effectiveGroupId = "groupId" in options ? options.groupId : selectedGroupId

  // ローカル（Dexie）クエリ - リスト
  const localLists = useLiveQuery(
    async () => {
      if (!store) return undefined
      return queryLists(store.db, { groupId: effectiveGroupId, status, includeCompleted })
    },
    [store, effectiveGroupId, status, includeCompleted]
  )

  // ローカル（Dexie）クエリ - リストアイテム（該当グループのリストに紐づくもの）
  const localListItems = useLiveQuery(
    async () => {
      if (!store || !localLists) return undefined
      return queryListItems(store.db, localLists.map((list) => list.id))
    },
    [store, localLists]
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
    isLoading: localLists === undefined || localListItems === undefined || awaitingFirstSync || isAuthLoading,
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
  const { mode, store, awaitingFirstSync, isAuthLoading } = useCatalogSource()
  const useServer = mode === "server"

  // ローカル（Dexie）クエリ
  const localList = useLiveQuery(
    async () => {
      if (!store) return undefined
      return store.db.lists.get(listId)
    },
    [store, listId]
  )

  const localListItems = useLiveQuery(
    async () => {
      if (!store) return undefined
      return queryListItems(store.db, [listId])
    },
    [store, listId]
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
    isLoading: localList === undefined || localListItems === undefined || awaitingFirstSync || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}
