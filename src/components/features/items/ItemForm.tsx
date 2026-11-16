"use client"

import { TEXT_LIMITS } from "@/shared/schemas/limits"
import { Badge, Button, LoadingSpinner } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { type ShoppingItem } from "@/lib/db"
import { cn } from "@/lib/utils"
import { extractFirstUrl } from "@/lib/url"
import { OGPPreview } from "./OGPPreview"
import { Minus, Plus, Trash2, Users, X } from "lucide-react"
import { useState } from "react"
import { useGroups, useTags, useItemMutations, useTagMutations } from "@/hooks/data"

export interface ItemFormProps {
  item?: ShoppingItem | null
  onClose: () => void
  onSaved?: () => void
  onDeleted?: () => void
  allowContinue?: boolean
  defaultGroupId?: string
}

export function ItemForm({ item, onClose, onSaved, onDeleted, allowContinue = false, defaultGroupId }: ItemFormProps) {
  const { user } = useAuth()
  const [name, setName] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [memo, setMemo] = useState("")
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(defaultGroupId)
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // サーバーファースト対応のhooksを使用
  const { groups, isLoading: isGroupsLoading } = useGroups()
  const { tags, isLoading: isTagsLoading } = useTags({ groupId: selectedGroupId })
  const { createItem, updateItem, deleteItem, isCreating, isUpdating, isDeleting } = useItemMutations()
  const { createTag } = useTagMutations()

  const isEditing = !!item
  const isLoading = isTagsLoading || (user && isGroupsLoading)
  const isProcessing = isCreating || isUpdating || isDeleting

  // アイテムが変更されたらフォームをリセット（レンダリング中に同期）
  const [prevItemId, setPrevItemId] = useState<string | null | undefined>(undefined)
  const currentItemId = item?.id ?? null
  if (currentItemId !== prevItemId) {
    setPrevItemId(currentItemId)
    if (item) {
      setName(item.name)
      setQuantity(item.quantity)
      setMemo(item.memo ?? "")
      setSelectedTagIds(item.tagIds)
      setSelectedGroupId(item.groupId)
    } else {
      setName("")
      setQuantity(1)
      setMemo("")
      setSelectedTagIds([])
      setSelectedGroupId(defaultGroupId)
    }
    setIsAddingTag(false)
    setNewTagName("")
    setShowDeleteConfirm(false)
  }

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => Math.min(TEXT_LIMITS.quantityMax, Math.max(1, prev + delta)))
  }

  const handleTagToggle = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  const handleAddTag = async () => {
    const trimmed = newTagName.trim()
    if (!trimmed) return

    // 同じグループ（または個人）の既存タグをチェック
    const existing = tags?.find((t) => t.name === trimmed && t.groupId === selectedGroupId)
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) {
        setSelectedTagIds((prev) => [...prev, existing.id])
      }
    } else {
      // 新しいタグを作成（同じグループに紐付け）
      const newTag = await createTag({ name: trimmed, groupId: selectedGroupId })
      setSelectedTagIds((prev) => [...prev, newTag.id])
    }

    setNewTagName("")
    setIsAddingTag(false)
  }

  const handleSubmit = async (e: React.FormEvent, continueAdding = false) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)
    // 保存中に利用者が次のアイテムを入力することがあるため、送った値を控えておく
    const submitted = { name, quantity, memo }

    try {
      if (isEditing && item) {
        await updateItem({
          id: item.id,
          name: name.trim(),
          quantity,
          memo: memo.trim() || undefined,
          tagIds: selectedTagIds,
          groupId: selectedGroupId,
        })
      } else {
        await createItem({
          name: name.trim(),
          quantity,
          memo: memo.trim() || undefined,
          tagIds: selectedTagIds,
          groupId: selectedGroupId,
        })
      }
      onSaved?.()

      if (continueAdding) {
        // フォームをリセットして続ける（タグは維持）
        // 送った値のままの項目だけ消す（保存中に入力された内容は残す）
        setName((cur) => (cur === submitted.name ? "" : cur))
        setQuantity((cur) => (cur === submitted.quantity ? 1 : cur))
        setMemo((cur) => (cur === submitted.memo ? "" : cur))
        setIsSubmitting(false)
      } else {
        onClose()
      }
    } catch (error) {
      console.error("Failed to save item:", error)
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!item) return

    setIsSubmitting(true)
    try {
      await deleteItem(item.id)
      onDeleted?.()
      onClose()
    } catch (error) {
      console.error("Failed to delete item:", error)
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length > 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="item-form">
      {/* アイテム名 */}
      <div>
        <label
          htmlFor="item-name"
          className="mb-2 block text-base font-semibold text-gray-900"
        >
          アイテム名
        </label>
        <input
          id="item-name"
          type="text"
          maxLength={TEXT_LIMITS.itemName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 牛乳"
          autoFocus
          autoComplete="off"
          data-testid="item-name-input"
          className={cn(
            "w-full rounded-lg border-2 border-gray-300 px-4 py-3",
            "text-lg font-semibold text-gray-900",
            "placeholder:font-normal placeholder:text-gray-400",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          )}
        />
      </div>

      {/* 数量 */}
      <div>
        <label className="mb-2 block text-base font-semibold text-gray-900">
          数量
        </label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => handleQuantityChange(-1)}
            disabled={quantity <= 1}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              "border-2 border-gray-300 text-gray-700",
              "transition-colors hover:bg-gray-100",
              "disabled:border-gray-200 disabled:text-gray-300"
            )}
            aria-label="数量を減らす"
            data-testid="quantity-decrease"
          >
            <Minus className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <span className="min-w-[56px] text-center text-3xl font-bold text-gray-900" data-testid="quantity-display">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => handleQuantityChange(1)}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              "border-2 border-gray-300 text-gray-700",
              "transition-colors hover:bg-gray-100"
            )}
            aria-label="数量を増やす"
            data-testid="quantity-increase"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* メモ */}
      <div>
        <label
          htmlFor="item-memo"
          className="mb-2 block text-base font-semibold text-gray-900"
        >
          メモ（任意）
        </label>
        <textarea
          id="item-memo"
          maxLength={TEXT_LIMITS.memo}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="例: 低脂肪タイプ"
          rows={2}
          data-testid="item-memo-input"
          className={cn(
            "w-full rounded-lg border-2 border-gray-300 px-4 py-3",
            "text-base font-medium text-gray-900",
            "placeholder:font-normal placeholder:text-gray-400",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
            "resize-none"
          )}
        />
        {extractFirstUrl(memo) && (
          <OGPPreview url={extractFirstUrl(memo)!} />
        )}
      </div>

      {/* グループ選択（ログイン時のみ） */}
      {user && groups && groups.length > 0 && (
        <div>
          <label className="mb-2 block text-base font-semibold text-gray-900">
            共有先グループ
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedGroupId(undefined)}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                selectedGroupId === undefined
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              )}
            >
              個人
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setSelectedGroupId(group.id)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                  selectedGroupId === group.id
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                )}
              >
                <Users className="h-4 w-4" />
                {group.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* タグ選択 */}
      <div>
        <label className="mb-2 block text-base font-semibold text-gray-900">
          タグ
        </label>
        <div className="flex flex-wrap gap-2">
          {tags?.map((tag) => {
            const isSelected = selectedTagIds.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleTagToggle(tag.id)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
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
                "flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium",
                "border-2 border-dashed border-gray-300 text-gray-500",
                "transition-colors hover:border-gray-400 hover:text-gray-700",
                "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              )}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              追加
            </button>
          )}
        </div>

        {isAddingTag && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={newTagName}
              maxLength={TEXT_LIMITS.tagName}
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
                "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white",
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
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {selectedTagIds.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-gray-600">選択中:</span>
            <div className="flex flex-wrap gap-1">
              {selectedTagIds.map((tagId) => {
                const tag = tags?.find((t) => t.id === tagId)
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

      {/* ボタン */}
      <div className="space-y-3 pt-2">
        {allowContinue && !isEditing ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 text-base font-semibold"
              disabled={!isValid || isSubmitting || isProcessing}
              onClick={(e) => handleSubmit(e, true)}
              data-testid="item-add-continue"
            >
              追加して続ける
            </Button>
            <Button
              type="submit"
              className="flex-1 text-base font-semibold"
              disabled={!isValid || isSubmitting || isProcessing}
              data-testid="item-add-close"
            >
              {isSubmitting || isProcessing ? "保存中..." : "追加して閉じる"}
            </Button>
          </div>
        ) : (
          <Button
            type="submit"
            className="w-full text-lg font-semibold"
            disabled={!isValid || isSubmitting || isProcessing}
            data-testid="item-submit"
          >
            {isSubmitting || isProcessing ? "保存中..." : isEditing ? "更新" : "追加"}
          </Button>
        )}

        {isEditing && (
          <>
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg py-3",
                  "text-red-600 transition-colors hover:bg-red-50"
                )}
                data-testid="item-delete-button"
              >
                <Trash2 className="h-5 w-5" />
                削除
              </button>
            ) : (
              <div className="rounded-lg bg-red-50 p-3" data-testid="item-delete-confirm">
                <p className="mb-3 text-center text-sm font-medium text-red-800">
                  本当に削除しますか？
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    className="flex-1"
                    onClick={handleDelete}
                    disabled={isSubmitting || isProcessing}
                    data-testid="item-delete-confirm-yes"
                  >
                    削除する
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    キャンセル
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  )
}
