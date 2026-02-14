"use client"

import { Badge, Button, Checkbox } from "@/components/ui"
import type { ShoppingItem, Tag } from "@/lib/db"
import { cn } from "@/lib/utils"
import { useTagMutations } from "@/hooks/data"
import { Minus, Package, Plus, X } from "lucide-react"
import { useState } from "react"

export type NewItemInput = {
  name: string
  quantity: number
  memo?: string
  tagIds: string[]
}

type ItemSelectorProps = {
  /** 選択可能な既存アイテム */
  existingItems: ShoppingItem[]
  /** タグ一覧 */
  tags: Tag[]
  /** グループID（新規アイテム作成時に使用） */
  groupId?: string
  /** 送信時のコールバック */
  onSubmit: (data: {
    selectedItemIds: string[]
    newItems: NewItemInput[]
  }) => Promise<void>
  /** 送信ボタンのラベル（カウント部分は自動で追加） */
  submitLabel?: string
  /** 送信中の表示 */
  submittingLabel?: string
  /** キャンセルボタンを表示するか */
  showCancel?: boolean
  /** キャンセル時のコールバック */
  onCancel?: () => void
}

/**
 * アイテム選択コンポーネント
 * 「既存アイテムから選択」と「新規入力」の2つのモードを持つ
 */
export function ItemSelector({
  existingItems,
  tags,
  groupId,
  onSubmit,
  submitLabel = "追加",
  submittingLabel = "追加中...",
  showCancel = false,
  onCancel,
}: ItemSelectorProps) {
  const [mode, setMode] = useState<"select" | "new">(
    existingItems.length > 0 ? "select" : "new"
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [filterTagIds, setFilterTagIds] = useState<string[]>([])
  const [newItems, setNewItems] = useState<NewItemInput[]>([])

  // 新規入力フォームの状態
  const [name, setName] = useState("")
  const [memo, setMemo] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { createTag } = useTagMutations()

  // タグでフィルタしたアイテム
  const filteredExistingItems =
    filterTagIds.length === 0
      ? existingItems
      : existingItems.filter((item) =>
          item.tagIds.some((tagId) => filterTagIds.includes(tagId))
        )

  // タグごとのアイテム数
  const tagItemCounts = new Map<string, number>()
  for (const tag of tags) {
    const count = existingItems.filter((item) =>
      item.tagIds.includes(tag.id)
    ).length
    tagItemCounts.set(tag.id, count)
  }

  const handleFilterTagToggle = (tagId: string) => {
    setFilterTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    )
  }

  const handleToggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const handleSelectAllVisible = () => {
    const visibleIds = filteredExistingItems.map((item) => item.id)
    setSelectedIds((prev) => {
      const newIds = new Set(prev)
      for (const id of visibleIds) {
        newIds.add(id)
      }
      return Array.from(newIds)
    })
  }

  const handleDeselectAllVisible = () => {
    const visibleIds = new Set(filteredExistingItems.map((item) => item.id))
    setSelectedIds((prev) => prev.filter((id) => !visibleIds.has(id)))
  }

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => Math.max(1, prev + delta))
  }

  const handleTagToggle = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    )
  }

  const handleAddTag = async () => {
    const trimmed = newTagName.trim()
    if (!trimmed) return

    const existing = tags.find((t) => t.name === trimmed)
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) {
        setSelectedTagIds((prev) => [...prev, existing.id])
      }
    } else {
      const newTag = await createTag({ name: trimmed, groupId })
      if (newTag) {
        setSelectedTagIds((prev) => [...prev, newTag.id])
      }
    }

    setNewTagName("")
    setIsAddingTag(false)
  }

  // 新規アイテムをリストに追加
  const handleAddNewItem = () => {
    if (!name.trim()) return

    setNewItems((prev) => [
      ...prev,
      {
        name: name.trim(),
        quantity,
        memo: memo.trim() || undefined,
        tagIds: selectedTagIds,
      },
    ])

    // フォームをリセット
    setName("")
    setMemo("")
    setQuantity(1)
    setSelectedTagIds([])
  }

  // 新規アイテムを削除
  const handleRemoveNewItem = (index: number) => {
    setNewItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (selectedIds.length === 0 && newItems.length === 0) return

    setIsSubmitting(true)
    try {
      await onSubmit({
        selectedItemIds: selectedIds,
        newItems,
      })
    } catch (error) {
      console.error("Submit failed:", error)
      setIsSubmitting(false)
    }
  }

  const totalCount = selectedIds.length + newItems.length

  return (
    <div className="space-y-4">
      {/* モード切替タブ */}
      <div className="flex rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => setMode("select")}
          data-testid="tab-select"
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            mode === "select"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          )}
        >
          <Package className="mr-2 inline-block h-4 w-4" />
          買いたいものから
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          data-testid="tab-new"
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            mode === "new"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          )}
        >
          <Plus className="mr-2 inline-block h-4 w-4" />
          新規入力
        </button>
      </div>

      {mode === "select" ? (
        <>
          {existingItems.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-gray-500">買いたいものがありません</p>
              <button
                type="button"
                onClick={() => setMode("new")}
                className="mt-2 text-sm font-medium text-blue-600"
              >
                新規入力で追加する
              </button>
            </div>
          ) : (
            <>
              {/* タグフィルタ */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setFilterTagIds([])}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      filterTagIds.length === 0
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                  >
                    すべて
                  </button>
                  {tags.map((tag) => {
                    const isSelected = filterTagIds.includes(tag.id)
                    const itemCount = tagItemCounts.get(tag.id) ?? 0
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => handleFilterTagToggle(tag.id)}
                        disabled={itemCount === 0}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                          isSelected
                            ? "bg-blue-600 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                      >
                        {tag.name}({itemCount})
                      </button>
                    )
                  })}
                </div>
              )}

              {filteredExistingItems.length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-sm text-gray-500">
                    該当するアイテムがありません
                  </p>
                </div>
              ) : (
                <>
                  {/* 一括選択ボタン */}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={handleSelectAllVisible}
                      data-testid="select-all"
                      disabled={
                        filteredExistingItems.every((item) =>
                          selectedIds.includes(item.id)
                        )
                      }
                    >
                      表示中をすべて選択
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={handleDeselectAllVisible}
                      data-testid="deselect-all"
                      disabled={
                        !filteredExistingItems.some((item) =>
                          selectedIds.includes(item.id)
                        )
                      }
                    >
                      表示中をすべて解除
                    </Button>
                  </div>

                  <ul className="max-h-52 space-y-2 overflow-y-auto" data-testid="existing-items-list">
                    {filteredExistingItems.map((item) => {
                      const isSelected = selectedIds.includes(item.id)
                      return (
                        <li
                          key={item.id}
                          className={cn(
                            "rounded-lg bg-gray-50 p-3",
                            isSelected && "bg-blue-50"
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            onChange={() => handleToggleItem(item.id)}
                            label={
                              item.quantity > 1
                                ? `${item.name} x${item.quantity}`
                                : item.name
                            }
                          />
                          {item.memo && (
                            <p className="ml-7 mt-1 text-xs text-gray-500">{item.memo}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {/* アイテム名 */}
          <div>
            <label
              htmlFor="item-name"
              className="mb-2 block text-sm font-semibold text-gray-900"
            >
              アイテム名
            </label>
            <input
              id="item-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 牛乳"
              autoFocus
              autoComplete="off"
              className={cn(
                "w-full rounded-lg border-2 border-gray-300 px-4 py-3",
                "text-lg font-semibold text-gray-900",
                "placeholder:font-normal placeholder:text-gray-400",
                "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              )}
            />
          </div>

          {/* メモ */}
          <div>
            <label
              htmlFor="item-memo"
              className="mb-2 block text-sm font-semibold text-gray-900"
            >
              メモ（任意）
            </label>
            <textarea
              id="item-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="例: 低脂肪タイプ"
              rows={2}
              className={cn(
                "w-full rounded-lg border-2 border-gray-300 px-4 py-3",
                "text-base font-medium text-gray-900",
                "placeholder:font-normal placeholder:text-gray-400",
                "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                "resize-none"
              )}
            />
          </div>

          {/* 数量 */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-900">
              数量
            </label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => handleQuantityChange(-1)}
                disabled={quantity <= 1}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full",
                  "border-2 border-gray-300 text-gray-700",
                  "transition-colors hover:bg-gray-100",
                  "disabled:border-gray-200 disabled:text-gray-300"
                )}
                aria-label="数量を減らす"
              >
                <Minus className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <span className="min-w-[48px] text-center text-2xl font-bold text-gray-900">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => handleQuantityChange(1)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full",
                  "border-2 border-gray-300 text-gray-700",
                  "transition-colors hover:bg-gray-100"
                )}
                aria-label="数量を増やす"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* タグ選択 */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-900">
              タグ
            </label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = selectedTagIds.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleTagToggle(tag.id)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                      isSelected
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                  >
                    {tag.name}
                  </button>
                )
              })}
              {!isAddingTag && (
                <button
                  type="button"
                  onClick={() => setIsAddingTag(true)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium",
                    "border-2 border-dashed border-gray-300 text-gray-500",
                    "transition-colors hover:border-gray-400 hover:text-gray-700",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  )}
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  追加
                </button>
              )}
            </div>

            {isAddingTag && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="新しいタグ名"
                  autoFocus
                  className={cn(
                    "flex-1 rounded-lg border-2 border-gray-300 px-3 py-2 text-sm",
                    "font-medium text-gray-900",
                    "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  )}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddTag()
                    }
                    if (e.key === "Escape") {
                      setIsAddingTag(false)
                      setNewTagName("")
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  disabled={!newTagName.trim()}
                  className={cn(
                    "rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white",
                    "transition-colors hover:bg-blue-700",
                    "disabled:bg-gray-300 disabled:text-gray-500"
                  )}
                >
                  追加
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingTag(false)
                    setNewTagName("")
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
                  aria-label="キャンセル"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {selectedTagIds.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-600">選択中:</span>
                <div className="flex flex-wrap gap-1">
                  {selectedTagIds.map((tagId) => {
                    const tag = tags.find((t) => t.id === tagId)
                    return tag ? (
                      <Badge key={tagId} variant="primary">
                        {tag.name}
                      </Badge>
                    ) : null
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 新規アイテム追加ボタン */}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={handleAddNewItem}
            disabled={!name.trim()}
          >
            <Plus className="mr-2 h-4 w-4" />
            リストに追加
          </Button>
        </div>
      )}

      {/* 追加済みの新規アイテム */}
      {newItems.length > 0 && (
        <div className="rounded-lg border-2 border-green-200 bg-green-50 p-3">
          <p className="mb-2 text-sm font-semibold text-green-800">
            新規追加アイテム ({newItems.length}件)
          </p>
          <ul className="space-y-2">
            {newItems.map((item, index) => (
              <li
                key={index}
                className="flex items-center justify-between rounded-lg bg-white p-2"
              >
                <span className="text-sm text-gray-900">
                  {item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveNewItem(index)}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="削除"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 送信ボタン */}
      <div className={cn("flex gap-2", showCancel ? "pt-2" : "")}>
        {showCancel && (
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onCancel}
          >
            キャンセル
          </Button>
        )}
        <Button
          className={showCancel ? "flex-1" : "w-full"}
          onClick={handleSubmit}
          disabled={totalCount === 0 || isSubmitting}
          data-testid="item-selector-submit"
        >
          {isSubmitting
            ? submittingLabel
            : totalCount === 0
              ? "アイテムを選択"
              : `${totalCount}件を${submitLabel}`}
        </Button>
      </div>
    </div>
  )
}
