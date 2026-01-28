"use client"

import { useCallback } from "react"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

type CreateGroupInput = {
  name: string
}

/**
 * グループのCRUD操作フック
 * ログイン時: サーバーAPI経由
 * 未ログイン時: ローカルDB直接操作
 */
export function useGroupMutations() {
  const { useServer, user } = useDataSource()
  const utils = trpc.useUtils()

  // サーバー側ミューテーション
  const createMutation = trpc.identity.createGroup.useMutation({
    onSuccess: () => {
      utils.identity.getGroups.invalidate()
    },
  })
  const updateMutation = trpc.identity.updateGroup.useMutation({
    onSuccess: () => {
      utils.identity.getGroups.invalidate()
    },
  })
  const createInviteMutation = trpc.identity.inviteMember.useMutation()

  // グループ作成
  const createGroup = useCallback(
    async (input: CreateGroupInput) => {
      if (useServer) {
        return createMutation.mutateAsync(input)
      }

      if (!user) throw new Error("ログインが必要です")

      // ローカル
      const groupId = crypto.randomUUID()
      const now = new Date()

      await db.groups.add({
        id: groupId,
        name: input.name,
        ownerId: user.id,
        createdAt: now,
        updatedAt: now,
      })

      // オーナーとしてメンバー追加
      await db.groupMembers.add({
        id: crypto.randomUUID(),
        groupId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        role: "owner",
        joinedAt: now,
      })

      return { id: groupId }
    },
    [useServer, user, createMutation]
  )

  // グループ更新
  const updateGroup = useCallback(
    async (input: { id: string; name: string }) => {
      if (useServer) {
        return updateMutation.mutateAsync(input)
      }

      await db.groups.update(input.id, { name: input.name })
      return { id: input.id }
    },
    [useServer, updateMutation]
  )

  // 招待リンク作成
  const createInvite = useCallback(
    async (groupId: string) => {
      if (useServer) {
        return createInviteMutation.mutateAsync({ groupId })
      }

      // ローカルでは招待機能は使えない（サーバー必須）
      throw new Error("招待機能を使用するにはログインが必要です")
    },
    [useServer, createInviteMutation]
  )

  return {
    createGroup,
    updateGroup,
    createInvite,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isCreatingInvite: createInviteMutation.isPending,
  }
}
