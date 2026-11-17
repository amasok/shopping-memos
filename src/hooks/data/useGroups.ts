"use client"

import { useCallback } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"
import { useCatalogSource } from "./useCatalogSource"
import { useSync } from "@/contexts/SyncContext"

/**
 * グループ一覧を取得するフック
 *
 * 重要: グループ一覧は「ログイン中」であれば常にサーバーのグループを出す
 * （グループ選択状態に関わらず）。サーバーに存在するグループのみを選択肢として表示するため
 *
 * - ログイン中・フラグ false（と merge の前）: tRPC の identity.getGroups
 * - ログイン中・フラグ true（merge 済み）: ユーザー DB の所属グループのキャッシュ（同期の pull のたびに上書き。#62 O7）。
 *   refetch は同期（作成・参加などの後に呼ぶ）。初回の同期が終わるまでは読み込み中
 * - 未ログイン: グループなし
 */
export function useGroups() {
  const { isAuthLoading, user } = useDataSource()
  const { mode, store, awaitingFirstSync } = useCatalogSource()
  const { sync } = useSync()

  // ログイン中かどうか
  const isLoggedIn = !!user
  const useCache = mode === "local"

  // ローカル（Dexie）クエリ - 未ログイン時はグループなし、フラグ true ならユーザー DB のキャッシュ
  const localGroups = useLiveQuery(
    async () => {
      if (useCache) {
        if (!store) return undefined
        const rows = await store.db.groups.orderBy("createdAt").toArray()
        return rows.map((g) => ({
          id: g.id,
          name: g.name,
          inviteCode: g.inviteCode ?? null,
          inviteEnabled: g.inviteEnabled ?? false,
          // キャッシュは招待コードの期限を持たない（一覧の画面では使わない）
          inviteCodeExpiresAt: null,
          createdAt: g.createdAt,
          updatedAt: g.updatedAt,
          memberCount: g.memberCount ?? 0,
        }))
      }
      if (isLoggedIn) return undefined // ログイン中はサーバーを使用
      return [] // 未ログイン時はグループなし
    },
    [isLoggedIn, useCache, store]
  )

  // サーバー（tRPC）クエリ - ログイン中で、キャッシュを使わないとき
  const serverQuery = trpc.identity.getGroups.useQuery(undefined, {
    enabled: isLoggedIn && !isAuthLoading && !useCache,
  })

  if (useCache) {
    return {
      groups: localGroups ?? [],
      isLoading: localGroups === undefined || awaitingFirstSync || isAuthLoading,
      error: null,
      refetch: sync,
    }
  }

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
  const { mode } = useCatalogSource()
  const { sync } = useSync()
  /**
   * グループの変更（tRPC。オンラインだけ）の後に、所属グループのキャッシュを新しくする（フラグ true のときだけ同期する。#62 O7）。
   * 待たない（画面の遷移を止めない）
   */
  const syncGroups = useCallback(() => {
    if (mode === "local") void sync()
  }, [mode, sync])

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
        syncGroups()
        await groupsQuery.refetch()
        await membersQuery.refetch()
      },
      syncGroups,
    }
  }

  return {
    group: localGroup ?? null,
    members: localMembers ?? [],
    isLoading: localGroup === undefined || localMembers === undefined || isAuthLoading,
    error: null,
    refetch: async () => {},
    syncGroups,
  }
}
