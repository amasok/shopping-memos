"use client"

import { useCallback } from "react"
import { trpc } from "@/infrastructure/trpc/client"
import * as catalogRepository from "@/infrastructure/local/catalogRepository"
import { requireStore, useCatalogSource } from "./useCatalogSource"

type CreateTagInput = {
  name: string
  groupId?: string
}
type UpdateTagInput = Partial<CreateTagInput> & { id: string }

/**
 * タグのCRUD操作フック（#62 O7）
 * - ログイン中・フラグ false: サーバーAPI経由
 * - ゲスト・ログイン中でフラグ true: 端末の DB のリポジトリ経由（フラグ true ならキューに積み、同期を予約する）
 */
export function useTagMutations() {
  const source = useCatalogSource()
  const useServer = source.mode === "server"
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

      // 端末の DB
      const tag = await catalogRepository.createTag(requireStore(source), input)
      source.afterWrite()
      return { id: tag.id }
    },
    [useServer, createMutation, source]
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

      // 端末の DB
      if (input.name !== undefined) {
        await catalogRepository.updateTag(requireStore(source), { id: input.id, name: input.name })
        source.afterWrite()
      }
      return { id: input.id }
    },
    [useServer, updateMutation, source]
  )

  // タグ削除
  const deleteTag = useCallback(
    async (id: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id })
      }

      // 端末の DB（商品の tagIds からも外す）
      await catalogRepository.deleteTag(requireStore(source), id)
      source.afterWrite()
      return { success: true }
    },
    [useServer, deleteMutation, source]
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
