"use client"

import { useCallback } from "react"
import { trpc } from "@/infrastructure/trpc/client"
import * as catalogRepository from "@/infrastructure/local/catalogRepository"
import { requireStore, useCatalogSource } from "./useCatalogSource"

type CreateItemInput = {
  name: string
  quantity: number
  memo?: string
  tagIds: string[]
  groupId?: string
}
type UpdateItemInput = Partial<CreateItemInput> & { id: string }

/**
 * アイテムのCRUD操作フック（#62 O7）
 * - ログイン中・フラグ false: サーバーAPI経由
 * - ゲスト・ログイン中でフラグ true: 端末の DB のリポジトリ経由（フラグ true ならキューに積み、同期を予約する）
 */
export function useItemMutations() {
  const source = useCatalogSource()
  const useServer = source.mode === "server"
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

      // 端末の DB
      const item = await catalogRepository.createItem(requireStore(source), input)
      source.afterWrite()
      return { id: item.id }
    },
    [useServer, createMutation, source]
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

      // 端末の DB
      await catalogRepository.updateItem(requireStore(source), input)
      source.afterWrite()
      return { id: input.id }
    },
    [useServer, updateMutation, source]
  )

  // アイテム削除
  const deleteItem = useCallback(
    async (id: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id })
      }

      // 端末の DB
      await catalogRepository.deleteItem(requireStore(source), id)
      source.afterWrite()
      return { success: true }
    },
    [useServer, deleteMutation, source]
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
