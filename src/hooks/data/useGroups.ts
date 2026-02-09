"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

/**
 * グループ一覧を取得するフック
 *
 * 重要: グループ一覧は「ログイン中」であれば常にサーバーから取得する
 * （グループ選択状態に関わらず）
 *
 * これは、サーバーに存在するグループのみを選択肢として表示するため
 */
export function useGroups() {
  const { isAuthLoading, user } = useDataSource()

  // ログイン中かどうか
  const isLoggedIn = !!user

  // ローカル（Dexie）クエリ - 未ログイン時のみ使用
  // 注意: グループはサーバーサイド機能のため、未ログイン時は常に空配列
  const localGroups = useLiveQuery(
    async () => {
      if (isLoggedIn) return undefined // ログイン中はサーバーを使用
      return [] // 未ログイン時はグループなし
    },
    [isLoggedIn]
  )

  // サーバー（tRPC）クエリ - ログイン中は常に有効
  const serverQuery = trpc.identity.getGroups.useQuery(undefined, {
    enabled: isLoggedIn && !isAuthLoading,
  })

  if (isLoggedIn) {
    return {
      groups: serverQuery.data ?? [],
      isLoading: serverQuery.isLoading || isAuthLoading,
      error: serverQuery.error,
      refetch: serverQuery.refetch,
    }
  }

  return {
    groups: localGroups ?? [],
    isLoading: localGroups === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}

interface UseGroupOptions {
  groupId: string
}

/**
 * グループ詳細を取得するフック
 * メンバー一覧も取得
 */
export function useGroup(options: UseGroupOptions) {
  const { groupId } = options
  const { useServer, isAuthLoading } = useDataSource()

  // ローカル（Dexie）クエリ
  const localGroup = useLiveQuery(
    async () => {
      if (useServer) return undefined
      return db.groups.get(groupId)
    },
    [useServer, groupId]
  )

  const localMembers = useLiveQuery(
    async () => {
      if (useServer) return undefined
      return db.groupMembers.where("groupId").equals(groupId).toArray()
    },
    [useServer, groupId]
  )

  // サーバー（tRPC）クエリ - グループ一覧から該当グループを取得
  const groupsQuery = trpc.identity.getGroups.useQuery(undefined, {
    enabled: useServer && !isAuthLoading,
  })

  // メンバー一覧を取得
  const membersQuery = trpc.identity.getGroupMembers.useQuery(
    { groupId },
    {
      enabled: useServer && !isAuthLoading,
    }
  )

  if (useServer) {
    const group = groupsQuery.data?.find((g) => g.id === groupId) ?? null
    return {
      group,
      members: membersQuery.data ?? [],
      isLoading: groupsQuery.isLoading || membersQuery.isLoading || isAuthLoading,
      error: groupsQuery.error || membersQuery.error,
      refetch: async () => {
        await groupsQuery.refetch()
        await membersQuery.refetch()
      },
    }
  }

  return {
    group: localGroup ?? null,
    members: localMembers ?? [],
    isLoading: localGroup === undefined || localMembers === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
  }
}
