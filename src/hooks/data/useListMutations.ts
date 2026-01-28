"use client"

import { useCallback } from "react"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"
import { useDataSource } from "./useDataSource"

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

/**
 * 買い物リストのCRUD操作フック
 * ログイン時: サーバーAPI経由
 * 未ログイン時: ローカルDB直接操作
 */
export function useListMutations() {
  const { useServer } = useDataSource()
  const utils = trpc.useUtils()

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
    },
  })
  const removeItemMutation = trpc.shopping.removeItemFromList.useMutation({
    onSuccess: () => {
      utils.shopping.getList.invalidate()
    },
  })
  const checkItemMutation = trpc.shopping.checkItem.useMutation({
    onSuccess: () => {
      utils.shopping.getList.invalidate()
    },
  })
  const finishMutation = trpc.shopping.finishShopping.useMutation({
    onSuccess: () => {
      utils.shopping.getLists.invalidate()
      utils.shopping.getHistory.invalidate()
      utils.catalog.getItems.invalidate()
    },
  })

  // リスト作成
  const createList = useCallback(
    async (input: CreateListInput) => {
      if (useServer) {
        return createMutation.mutateAsync(input)
      }

      // ローカル
      const listId = crypto.randomUUID()
      const now = new Date()

      // リスト作成
      await db.lists.add({
        id: listId,
        name: input.name,
        status: "in_progress",
        groupId: input.groupId,
        createdAt: now,
        completedAt: undefined,
      })

      // itemIds指定時はアイテムを追加
      if (input.itemIds && input.itemIds.length > 0) {
        for (const itemId of input.itemIds) {
          const item = await db.items.get(itemId)
          if (item) {
            await db.listItems.add({
              id: crypto.randomUUID(),
              listId,
              name: item.name,
              quantity: item.quantity,
              memo: item.memo,
              tagIds: item.tagIds,
              groupId: item.groupId,
              checked: false,
              createdAt: now,
            })
          }
        }
      }

      // tagIds指定時はタグに紐づくアイテムを追加
      if (input.tagIds && input.tagIds.length > 0) {
        const items = await db.items
          .filter(
            (item) =>
              !item.purchasedAt &&
              item.groupId === input.groupId &&
              item.tagIds.some((tagId) => input.tagIds!.includes(tagId))
          )
          .toArray()

        for (const item of items) {
          await db.listItems.add({
            id: crypto.randomUUID(),
            listId,
            name: item.name,
            quantity: item.quantity,
            memo: item.memo,
            tagIds: item.tagIds,
            groupId: item.groupId,
            checked: false,
            createdAt: now,
          })
        }
      }

      return { id: listId }
    },
    [useServer, createMutation]
  )

  // リスト更新
  const updateList = useCallback(
    async (input: { id: string; name?: string }) => {
      if (useServer) {
        return updateMutation.mutateAsync(input)
      }

      await db.lists.update(input.id, { name: input.name })
      return { id: input.id }
    },
    [useServer, updateMutation]
  )

  // リスト削除
  const deleteList = useCallback(
    async (id: string) => {
      if (useServer) {
        return deleteMutation.mutateAsync({ id })
      }

      // リストアイテムも削除
      await db.listItems.where("listId").equals(id).delete()
      await db.lists.delete(id)
      return { success: true }
    },
    [useServer, deleteMutation]
  )

  // リストにアイテム追加
  const addItemToList = useCallback(
    async (input: AddItemToListInput) => {
      if (useServer) {
        return addItemMutation.mutateAsync(input)
      }

      const item = await db.items.get(input.itemId)
      if (!item) throw new Error("アイテムが見つかりません")

      const now = new Date()
      await db.listItems.add({
        id: crypto.randomUUID(),
        listId: input.listId,
        name: item.name,
        quantity: item.quantity,
        memo: item.memo,
        tagIds: item.tagIds,
        groupId: item.groupId,
        checked: false,
        createdAt: now,
      })

      return { success: true }
    },
    [useServer, addItemMutation]
  )

  // リストからアイテム削除
  const removeItemFromList = useCallback(
    async (listItemId: string) => {
      if (useServer) {
        return removeItemMutation.mutateAsync({ id: listItemId })
      }

      await db.listItems.delete(listItemId)
      return { success: true }
    },
    [useServer, removeItemMutation]
  )

  // アイテムのチェック状態切り替え
  const checkItem = useCallback(
    async (listItemId: string, checked: boolean) => {
      if (useServer) {
        return checkItemMutation.mutateAsync({ listItemId, checked })
      }

      await db.listItems.update(listItemId, { checked })
      return { success: true }
    },
    [useServer, checkItemMutation]
  )

  // 買い物完了
  const finishShopping = useCallback(
    async (listId: string, location?: string) => {
      if (useServer) {
        return finishMutation.mutateAsync({ listId, location })
      }

      // ローカル処理
      const list = await db.lists.get(listId)
      if (!list) throw new Error("リストが見つかりません")

      const listItems = await db.listItems.where("listId").equals(listId).toArray()
      const checkedItems = listItems.filter((item) => item.checked)

      if (checkedItems.length === 0) {
        throw new Error("購入済みのアイテムがありません")
      }

      const now = new Date()

      // 履歴作成
      const historyId = crypto.randomUUID()
      await db.history.add({
        id: historyId,
        listId,
        location,
        itemIds: checkedItems.map((item) => item.id),
        groupId: list.groupId,
        purchasedAt: now,
      })

      // カタログアイテムのpurchasedAtを更新（名前でマッチング）
      for (const listItem of checkedItems) {
        const items = await db.items
          .filter((item) => item.name === listItem.name && !item.purchasedAt)
          .toArray()
        for (const item of items) {
          await db.items.update(item.id, { purchasedAt: now })
        }
      }

      // リストを完了状態に
      await db.lists.update(listId, {
        status: "completed",
        completedAt: now,
      })

      return {
        historyId,
        purchasedCount: checkedItems.length,
        skippedCount: listItems.length - checkedItems.length,
      }
    },
    [useServer, finishMutation]
  )

  return {
    createList,
    updateList,
    deleteList,
    addItemToList,
    removeItemFromList,
    checkItem,
    finishShopping,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isAddingItem: addItemMutation.isPending,
    isRemovingItem: removeItemMutation.isPending,
    isCheckingItem: checkItemMutation.isPending,
    isFinishing: finishMutation.isPending,
  }
}
