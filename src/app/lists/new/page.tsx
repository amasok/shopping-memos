"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, Checkbox, Input, PageContainer } from "@/components/ui"
import { db } from "@/lib/db"
import { deleteItems } from "@/lib/db/items"
import { addListItems, createList } from "@/lib/db/lists"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { Check } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

export default function NewListPage() {
  const router = useRouter()
  const [listName, setListName] = useState("")
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  const items = useLiveQuery(
    () => db.items.orderBy("createdAt").reverse().toArray(),
    []
  )
  const tags = useLiveQuery(() => db.tags.orderBy("createdAt").toArray(), [])

  const isLoading = items === undefined || tags === undefined

  // タグごとのアイテムIDをマッピング
  const tagItemIds = new Map<string, string[]>()
  if (items && tags) {
    for (const tag of tags) {
      const ids = items
        .filter((item) => item.tagIds.includes(tag.id))
        .map((item) => item.id)
      tagItemIds.set(tag.id, ids)
    }
  }

  // タグが選択されているかどうか（そのタグの全アイテムが選択されている）
  const isTagSelected = (tagId: string): boolean => {
    const ids = tagItemIds.get(tagId) ?? []
    if (ids.length === 0) return false
    return ids.every((id) => selectedItemIds.includes(id))
  }

  // タグが部分的に選択されているか
  const isTagPartiallySelected = (tagId: string): boolean => {
    const ids = tagItemIds.get(tagId) ?? []
    if (ids.length === 0) return false
    const selectedCount = ids.filter((id) => selectedItemIds.includes(id)).length
    return selectedCount > 0 && selectedCount < ids.length
  }

  const handleTagToggle = (tagId: string) => {
    const ids = tagItemIds.get(tagId) ?? []
    if (ids.length === 0) return

    if (isTagSelected(tagId)) {
      // すべて選択されている → すべて解除
      setSelectedItemIds((prev) => prev.filter((id) => !ids.includes(id)))
    } else {
      // 一部または未選択 → すべて選択
      setSelectedItemIds((prev) => {
        const newIds = new Set(prev)
        for (const id of ids) {
          newIds.add(id)
        }
        return Array.from(newIds)
      })
    }
  }

  const handleItemToggle = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    )
  }

  const handleSelectAll = () => {
    if (items) {
      setSelectedItemIds(items.map((item) => item.id))
    }
  }

  const handleDeselectAll = () => {
    setSelectedItemIds([])
  }

  const handleCreateList = async () => {
    if (selectedItemIds.length === 0) return

    setIsCreating(true)

    try {
      const selectedItems = (items ?? []).filter((item) =>
        selectedItemIds.includes(item.id)
      )

      // リストを作成
      const list = await createList(listName || undefined)

      // アイテムをリストに追加
      await addListItems(
        list.id,
        selectedItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
        }))
      )

      // 買いたいものから選択されたアイテムを削除
      await deleteItems(selectedItemIds)

      router.push(`/lists/${list.id}`)
    } catch (error) {
      console.error("Failed to create list:", error)
      setIsCreating(false)
    }
  }

  if (isLoading) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="リスト作成" showBackButton backHref="/lists" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  // アイテムがない場合
  if ((items?.length ?? 0) === 0) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="リスト作成" showBackButton backHref="/lists" />
        <PageContainer>
          <div className="py-8 text-center">
            <p className="text-base text-gray-500">買いたいものがありません</p>
            <p className="mt-2 text-sm text-gray-400">
              まずはアイテムを追加してください
            </p>
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  const allSelected = selectedItemIds.length === items?.length

  return (
    <AppLayout showBottomNav={false}>
      <Header title="リスト作成" showBackButton backHref="/lists" />
      <PageContainer>
        <div className="space-y-6">
          {/* リスト名 */}
          <Input
            label="リスト名（任意）"
            name="listName"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="例: スーパーで買い物"
          />

          {/* タグ選択 */}
          {(tags?.length ?? 0) > 0 && (
            <div>
              <label className="mb-2 block text-base font-semibold text-gray-900">
                タグで一括選択
              </label>
              <div className="flex flex-wrap gap-2">
                {tags?.map((tag) => {
                  const selected = isTagSelected(tag.id)
                  const partial = isTagPartiallySelected(tag.id)
                  const itemCount = tagItemIds.get(tag.id)?.length ?? 0

                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleTagToggle(tag.id)}
                      disabled={itemCount === 0}
                      className={cn(
                        "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        selected
                          ? "bg-blue-600 text-white"
                          : partial
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded border-2",
                          selected
                            ? "border-white bg-white"
                            : partial
                              ? "border-blue-600 bg-blue-600"
                              : "border-gray-400 bg-white"
                        )}
                      >
                        {(selected || partial) && (
                          <Check
                            className={cn(
                              "h-3.5 w-3.5",
                              selected ? "text-blue-600" : "text-white"
                            )}
                            strokeWidth={3}
                          />
                        )}
                      </span>
                      {tag.name}
                      <span className="opacity-70">({itemCount})</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 一括選択ボタン */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={handleSelectAll}
              disabled={allSelected}
            >
              すべて選択
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={handleDeselectAll}
              disabled={selectedItemIds.length === 0}
            >
              すべて解除
            </Button>
          </div>

          {/* アイテム一覧 */}
          <div>
            <label className="mb-2 block text-base font-semibold text-gray-900">
              アイテムを選択
              <span className="ml-2 font-normal text-gray-500">
                ({selectedItemIds.length}/{items?.length ?? 0}件)
              </span>
            </label>
            <ul className="space-y-2">
              {items?.map((item) => {
                const isSelected = selectedItemIds.includes(item.id)
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-lg bg-white p-3 shadow-sm",
                      !isSelected && "opacity-50"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={() => handleItemToggle(item.id)}
                      label={
                        item.quantity > 1
                          ? `${item.name} x${item.quantity}`
                          : item.name
                      }
                    />
                  </li>
                )
              })}
            </ul>
          </div>

          {/* 作成ボタン */}
          <div className="space-y-3 pt-2">
            <Button
              className="w-full"
              onClick={handleCreateList}
              disabled={selectedItemIds.length === 0 || isCreating}
            >
              {isCreating
                ? "作成中..."
                : selectedItemIds.length === 0
                  ? "アイテムを選択してください"
                  : `${selectedItemIds.length}件でリストを作成`}
            </Button>
          </div>
        </div>
      </PageContainer>
    </AppLayout>
  )
}
