"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { getGroupsByUserId } from "@/lib/db/groups"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

/**
 * グループ一覧を取得するフック
 * ログイン時: サーバーから取得
 * 未ログイン時: ローカルDBから取得
 */
export function useGroups() {
  const { useServer, isAuthLoading, user } = useDataSource()

  // ローカル（Dexie）クエリ
  const localGroups = useLiveQuery(
    async () => {
      if (useServer) return undefined
      if (!user) return []
      return getGroupsByUserId(user.id)
    },
    [useServer, user?.id]
  )

  // サーバー（tRPC）クエリ
  const serverQuery = trpc.identity.getGroups.useQuery(undefined, {
    enabled: useServer && !isAuthLoading,
  })

  if (useServer) {
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
