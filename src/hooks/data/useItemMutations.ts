"use client"

import { useCallback } from "react"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

type CreateItemInput = {
  name: string
  quantity: number
  memo?: string
  tagIds: string[]
  groupId?: string
}
type UpdateItemInput = Partial<CreateItemInput> & { id: string }

/**
 * アイテムのCRUD操作フック
 * ログイン時: サーバーAPI経由
 * 未ログイン時: ローカルDB直接操作
 */
export function useItemMutations() {
  const { useServer } = useDataSource()
  const utils = trpc.useUtils()

  // サーバー側ミューテーション
  const createMutation = trpc.catalog.createItem.useMutation({
    onSuccess: () => {
      utils.catalog.getItems.invalidate()
    },
  })
  const updateMutation = trpc.catalog.updateItem.useMutation({
    onSuccess: () => {
      utils.catalog.getItems.invalidate()
    },
  })
  const deleteMutation = trpc.catalog.deleteItem.useMutation({
    onSuccess: () => {
      utils.catalog.getItems.invalidate()
    },
  })

  // アイテム作成
  const createItem = useCallback(
    async (input: CreateItemInput) => {
      if (useServer) {
        return createMutation.mutateAsync({
          name: input.name,
          quantity: input.quantity,
          memo: input.memo ?? undefined,
          tagIds: input.tagIds,
          groupId: input.groupId ?? undefined,
        })
      }

      // ローカル
      const id = crypto.randomUUID()
      const now = new Date()
      await db.items.add({
        id,
        name: input.name,
        quantity: input.quantity,
        memo: input.memo,
        tagIds: input.tagIds,
        groupId: input.groupId,
        createdAt: now,
        updatedAt: now,
        purchasedAt: undefined,
      })
      return { id }
    },
    [useServer, createMutation]
  )

  // アイテム更新
  const updateItem = useCallback(
    async (input: UpdateItemInput) => {
      if (useServer) {
        return updateMutation.mutateAsync({
          id: input.id,
          name: input.name,
          quantity: input.quantity,
          memo: input.memo ?? undefined,
          tagIds: input.tagIds,
        })
      }

      // ローカル
      await db.items.update(input.id, input)
      return { id: input.id }
    },
    [useServer, updateMutation]
  )

  // アイテム削除
  const deleteItem = useCallback(
    async (id: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id })
      }

      // ローカル
      await db.items.delete(id)
      return { success: true }
    },
    [useServer, deleteMutation]
  )

  return {
    createItem,
    updateItem,
    deleteItem,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
