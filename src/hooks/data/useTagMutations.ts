"use client"

import { useCallback } from "react"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

type CreateTagInput = {
  name: string
  groupId?: string
}
type UpdateTagInput = Partial<CreateTagInput> & { id: string }

/**
 * タグのCRUD操作フック
 * ログイン時: サーバーAPI経由
 * 未ログイン時: ローカルDB直接操作
 */
export function useTagMutations() {
  const { useServer } = useDataSource()
  const utils = trpc.useUtils()

  // サーバー側ミューテーション
  const createMutation = trpc.catalog.createTag.useMutation({
    onSuccess: () => {
      utils.catalog.getTags.invalidate()
    },
  })
  const updateMutation = trpc.catalog.updateTag.useMutation({
    onSuccess: () => {
      utils.catalog.getTags.invalidate()
    },
  })
  const deleteMutation = trpc.catalog.deleteTag.useMutation({
    onSuccess: () => {
      utils.catalog.getTags.invalidate()
    },
  })

  // タグ作成
  const createTag = useCallback(
    async (input: CreateTagInput) => {
      if (useServer) {
        return createMutation.mutateAsync({
          name: input.name,
          groupId: input.groupId ?? undefined,
        })
      }

      // ローカル
      const id = crypto.randomUUID()
      const now = new Date()
      await db.tags.add({
        id,
        name: input.name,
        groupId: input.groupId,
        createdAt: now,
        updatedAt: now,
      })
      return { id }
    },
    [useServer, createMutation]
  )

  // タグ更新
  const updateTag = useCallback(
    async (input: UpdateTagInput) => {
      if (useServer) {
        return updateMutation.mutateAsync({
          id: input.id,
          name: input.name,
        })
      }

      // ローカル
      await db.tags.update(input.id, input)
      return { id: input.id }
    },
    [useServer, updateMutation]
  )

  // タグ削除
  const deleteTag = useCallback(
    async (id: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id })
      }

      // ローカル
      await db.tags.delete(id)
      // アイテムからタグIDを削除
      const items = await db.items.filter((item) => item.tagIds.includes(id)).toArray()
      for (const item of items) {
        await db.items.update(item.id, {
          tagIds: item.tagIds.filter((tagId) => tagId !== id),
        })
      }
      return { success: true }
    },
    [useServer, deleteMutation]
  )

  return {
    createTag,
    updateTag,
    deleteTag,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
