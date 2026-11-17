"use client"

import { useCallback } from "react"
import { trpc } from "@/infrastructure/trpc/client"
import * as shoppingRepository from "@/infrastructure/local/shoppingRepository"
import { requireStore, useCatalogSource } from "./useCatalogSource"

type CreateListInput = {
  name: string
  groupId?: string
  itemIds?: string[]
  tagIds?: string[]
}

type AddItemToListInput = {
  listId: string
  itemId: string
}

type AddNewItemToListInput = {
  listId: string
  name: string
  quantity?: number
  memo?: string
  tagIds?: string[]
}

/**
 * 買い物リストのCRUD操作フック（#62 O8）
 * - ログイン中・フラグ false: サーバーAPI経由
 * - ゲスト・ログイン中でフラグ true: 端末の DB のリポジトリ経由（フラグ true ならキューに積み、同期を予約する）
 */
export function useListMutations() {
  const source = useCatalogSource()
  const useServer = source.mode === "server"
  const utils = trpc.useUtils()
  // サーバーファーストで、カタログの一覧のキャッシュを無効にする（ゲスト・ローカルファーストでは何もしない。#62 O8）
  const { refreshCatalog } = source

  // サーバー側ミューテーション
  const createMutation = trpc.shopping.createList.useMutation({
    onSuccess: () => {
      utils.shopping.getLists.invalidate()
    },
  })
  const updateMutation = trpc.shopping.updateList.useMutation({
    onSuccess: () => {
      utils.shopping.getLists.invalidate()
      utils.shopping.getList.invalidate()
    },
  })
  const deleteMutation = trpc.shopping.deleteList.useMutation({
    onSuccess: () => {
      utils.shopping.getLists.invalidate()
    },
  })
  const addItemMutation = trpc.shopping.addItemToList.useMutation({
    onSuccess: () => {
      utils.shopping.getList.invalidate()
      utils.shopping.getLists.invalidate()
      refreshCatalog() // リストに追加したアイテムをカタログから除外
    },
  })
  const addNewItemMutation = trpc.shopping.addNewItemToList.useMutation({
    onSuccess: () => {
      utils.shopping.getList.invalidate()
      utils.shopping.getLists.invalidate()
      refreshCatalog() // リストに追加したアイテムをカタログから除外
    },
  })
  const removeItemMutation = trpc.shopping.removeItemFromList.useMutation({
    onSuccess: () => {
      utils.shopping.getList.invalidate()
      utils.shopping.getLists.invalidate()
      refreshCatalog() // リストから外したアイテムをカタログに表示
    },
  })
  const checkItemMutation = trpc.shopping.checkItem.useMutation({
    onSuccess: () => {
      utils.shopping.getList.invalidate()
      utils.shopping.getLists.invalidate()
    },
  })
  const finishMutation = trpc.shopping.finishShopping.useMutation({
    onSuccess: () => {
      utils.shopping.getLists.invalidate()
      utils.shopping.getHistory.invalidate()
      refreshCatalog()
    },
  })

  // リスト作成
  const createList = useCallback(
    async (input: CreateListInput) => {
      if (useServer) {
        return createMutation.mutateAsync(input)
      }

      const list = await shoppingRepository.createList(requireStore(source), input)
      source.afterWrite()
      return { id: list.id }
    },
    [useServer, createMutation, source]
  )

  // リスト更新
  const updateList = useCallback(
    async (input: { id: string; name?: string }) => {
      if (useServer) {
        return updateMutation.mutateAsync(input)
      }

      if (input.name !== undefined) {
        await shoppingRepository.updateList(requireStore(source), { id: input.id, name: input.name })
        source.afterWrite()
      }
      return { id: input.id }
    },
    [useServer, updateMutation, source]
  )

  // リスト削除
  const deleteList = useCallback(
    async (id: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id })
      }

      await shoppingRepository.deleteList(requireStore(source), id)
      source.afterWrite()
      return { success: true }
    },
    [useServer, deleteMutation, source]
  )

  // リストにアイテム追加（既存アイテムを追加）
  const addItemToList = useCallback(
    async (input: AddItemToListInput) => {
      if (useServer) {
        return addItemMutation.mutateAsync(input)
      }

      await shoppingRepository.addItemToList(requireStore(source), input)
      source.afterWrite()
      return { success: true }
    },
    [useServer, addItemMutation, source]
  )

  // リストに新規アイテム追加（直接入力）
  const addNewItemToList = useCallback(
    async (input: AddNewItemToListInput) => {
      if (useServer) {
        return addNewItemMutation.mutateAsync(input)
      }

      await shoppingRepository.addNewItemToList(requireStore(source), input)
      source.afterWrite()
      return { success: true }
    },
    [useServer, addNewItemMutation, source]
  )

  // リストからアイテム削除
  const removeItemFromList = useCallback(
    async (listItemId: string) => {
      if (useServer) {
        return removeItemMutation.mutateAsync({ id: listItemId })
      }

      await shoppingRepository.removeItemFromList(requireStore(source), listItemId)
      source.afterWrite()
      return { success: true }
    },
    [useServer, removeItemMutation, source]
  )

  // アイテムのチェック状態切り替え
  const checkItem = useCallback(
    async (listItemId: string, checked: boolean) => {
      if (useServer) {
        return checkItemMutation.mutateAsync({ listItemId, checked })
      }

      await shoppingRepository.checkItem(requireStore(source), listItemId, checked)
      source.afterWrite()
      return { success: true }
    },
    [useServer, checkItemMutation, source]
  )

  // 買い物完了
  const finishShopping = useCallback(
    async (listId: string, location?: string) => {
      if (useServer) {
        return finishMutation.mutateAsync({ listId, location })
      }

      // ゲストは 179b が決まるまで今の規則（チェック 0 件はエラー、照合は未購入だけ）。ローカルファーストはサーバーと同じ
      const result = await shoppingRepository.finishShopping(
        requireStore(source),
        listId,
        location,
        source.mode === "local" ? "server" : "guest"
      )
      source.afterWrite()
      return result
    },
    [useServer, finishMutation, source]
  )

  return {
    createList,
    updateList,
    deleteList,
    addItemToList,
    addNewItemToList,
    removeItemFromList,
    checkItem,
    finishShopping,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isAddingItem: addItemMutation.isPending,
    isAddingNewItem: addNewItemMutation.isPending,
    isRemovingItem: removeItemMutation.isPending,
    isCheckingItem: checkItemMutation.isPending,
    isFinishing: finishMutation.isPending,
  }
}
