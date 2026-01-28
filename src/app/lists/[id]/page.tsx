"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Badge, BottomSheet, Button, Checkbox, PageContainer } from "@/components/ui"
import { db, type ShoppingItem, type Tag } from "@/lib/db"
import { deleteItems } from "@/lib/db/items"
import { createTag } from "@/lib/db/tags"
import {
  addListItem,
  addListItems,
  finishShopping,
  removeListItemAndReturnToItems,
  toggleListItem,
} from "@/lib/db/lists"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CheckCircle,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Undo2,
  X,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"

export default function ShoppingListPage() {
  const params = useParams()
  const router = useRouter()
  const listId = params.id as string
  const [isCompleting, setIsCompleting] = useState(false)
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null)
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false)

  const list = useLiveQuery(() => db.lists.get(listId), [listId])
  const listItems = useLiveQuery(
    () => db.listItems.where("listId").equals(listId).toArray(),
    [listId]
  )
  // 買いたいもの一覧（リストに追加するため）
  const items = useLiveQuery(
    () => db.items.orderBy("createdAt").reverse().toArray(),
    []
  )
  // タグ一覧
  const tags = useLiveQuery(() => db.tags.orderBy("createdAt").toArray(), [])

  const isLoading =
    list === undefined ||
    listItems === undefined ||
    items === undefined ||
    tags === undefined

  const uncheckedItems = (listItems ?? []).filter((item) => !item.checked)
  const checkedItems = (listItems ?? []).filter((item) => item.checked)
  const progress =
    listItems && listItems.length > 0
      ? (checkedItems.length / listItems.length) * 100
      : 0
  const allChecked =
    uncheckedItems.length === 0 && (listItems?.length ?? 0) > 0

  const handleToggle = async (id: string, checked: boolean) => {
    await toggleListItem(id, !checked)
  }

  const handleRemove = async (id: string) => {
    await removeListItemAndReturnToItems(id)
    setRemoveTargetId(null)
  }

  const handleComplete = async () => {
    setIsCompleting(true)
    try {
      await finishShopping(listId, list?.name)
      router.push("/history")
    } catch (error) {
      console.error("Failed to complete shopping:", error)
      setIsCompleting(false)
    }
  }

  if (isLoading) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="買い物中" showBackButton backHref="/lists" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  if (!list) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="買い物中" showBackButton backHref="/lists" />
        <PageContainer>
          <div className="py-8 text-center">
            <p className="text-base text-gray-500">リストが見つかりません</p>
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  return (
    <AppLayout showBottomNav={false}>
      <Header
        title={list.name || "買い物中"}
        showBackButton
        backHref="/lists"
      />

      {/* プログレスバー */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-lg">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">進捗</span>
            <span className="font-semibold text-gray-900">
              {checkedItems.length}/{listItems?.length ?? 0}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <PageContainer>
        <div className="space-y-6">
          {/* 未チェックのアイテム */}
          {uncheckedItems.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-500">
                <ShoppingCart className="h-4 w-4" />
                買うもの
              </h2>
              <ul className="space-y-2">
                {uncheckedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg bg-white p-4 shadow-sm"
                  >
                    <div className="flex-1">
                      <Checkbox
                        checked={item.checked}
                        onChange={() => handleToggle(item.id, item.checked)}
                        label={
                          item.quantity > 1
                            ? `${item.name} x${item.quantity}`
                            : item.name
                        }
                      />
                    </div>
                    {removeTargetId === item.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRemove(item.id)}
                        >
                          外す
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveTargetId(null)}
                        >
                          戻す
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemoveTargetId(item.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-orange-500"
                        aria-label="リストから外す"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* チェック済みのアイテム */}
          {checkedItems.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-500">
                <CheckCircle className="h-4 w-4" />
                カゴに入れた
              </h2>
              <ul className="space-y-2">
                {checkedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg bg-white/50 p-4"
                  >
                    <div className="flex-1">
                      <Checkbox
                        checked={item.checked}
                        onChange={() => handleToggle(item.id, item.checked)}
                        strikethrough
                        label={
                          item.quantity > 1
                            ? `${item.name} x${item.quantity}`
                            : item.name
                        }
                      />
                    </div>
                    {removeTargetId === item.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRemove(item.id)}
                        >
                          外す
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveTargetId(null)}
                        >
                          戻す
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemoveTargetId(item.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-orange-500"
                        aria-label="リストから外す"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* アイテムがない場合 */}
          {(listItems?.length ?? 0) === 0 && (
            <div className="py-8 text-center">
              <p className="text-base text-gray-500">アイテムがありません</p>
              <p className="mt-2 text-sm text-gray-400">
                下の「+」ボタンから追加できます
              </p>
            </div>
          )}

          {/* 完了ボタン */}
          {allChecked && (listItems?.length ?? 0) > 0 && (
            <div
              className={cn(
                "rounded-xl bg-green-50 p-4 text-center",
                "border-2 border-green-200"
              )}
            >
              <CheckCircle className="mx-auto mb-2 h-12 w-12 text-green-600" />
              <p className="mb-4 font-semibold text-green-800">
                すべてカゴに入れました！
              </p>
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={handleComplete}
                disabled={isCompleting}
              >
                {isCompleting ? "処理中..." : "購入完了"}
              </Button>
            </div>
          )}

          {!allChecked && (listItems?.length ?? 0) > 0 && (
            <div className="pt-4">
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleComplete}
                disabled={isCompleting || checkedItems.length === 0}
              >
                {checkedItems.length === 0
                  ? "カゴに入れたものがありません"
                  : `${checkedItems.length}件を購入完了にする`}
              </Button>
              <p className="mt-2 text-center text-sm text-gray-500">
                チェックしていないアイテムは「買いたいもの」に戻ります
              </p>
            </div>
          )}
        </div>
      </PageContainer>

      {/* アイテム追加ボタン（FAB） */}
      <button
        type="button"
        onClick={() => setIsAddSheetOpen(true)}
        className={cn(
          "fixed bottom-6 right-4 z-20",
          "flex h-14 w-14 items-center justify-center",
          "rounded-full bg-blue-600 text-white shadow-lg",
          "transition-transform hover:scale-105 active:scale-95",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        )}
        aria-label="アイテムを追加"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* アイテム追加ボトムシート */}
      <BottomSheet
        isOpen={isAddSheetOpen}
        onClose={() => setIsAddSheetOpen(false)}
        title="アイテムを追加"
      >
        <AddItemSheet
          listId={listId}
          existingItems={items ?? []}
          tags={tags ?? []}
          onClose={() => setIsAddSheetOpen(false)}
        />
      </BottomSheet>
    </AppLayout>
  )
}

// アイテム追加シート
function AddItemSheet({
  listId,
  existingItems,
  tags,
  onClose,
}: {
  listId: string
  existingItems: ShoppingItem[]
  tags: Tag[]
  onClose: () => void
}) {
  const [mode, setMode] = useState<"select" | "new">(
    existingItems.length > 0 ? "select" : "new"
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [name, setName] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleToggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const handleAddFromItems = async () => {
    if (selectedIds.length === 0) return

    setIsSubmitting(true)
    try {
      const selected = existingItems.filter((item) =>
        selectedIds.includes(item.id)
      )

      // リストに追加（タグを保持）
      await addListItems(
        listId,
        selected.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          tagIds: item.tagIds,
        }))
      )

      // 買いたいものから削除
      await deleteItems(selectedIds)

      onClose()
    } catch (error) {
      console.error("Failed to add items:", error)
      setIsSubmitting(false)
    }
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
      const newTag = await createTag(trimmed)
      setSelectedTagIds((prev) => [...prev, newTag.id])
    }

    setNewTagName("")
    setIsAddingTag(false)
  }

  const handleAddNew = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)
    try {
      await addListItem(listId, name.trim(), quantity, selectedTagIds)
      setName("")
      setQuantity(1)
      setSelectedTagIds([])
      onClose()
    } catch (error) {
      console.error("Failed to add item:", error)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* モード切替タブ */}
      <div className="flex rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => setMode("select")}
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
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {existingItems.map((item) => {
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
                    </li>
                  )
                })}
              </ul>
              <Button
                className="w-full"
                onClick={handleAddFromItems}
                disabled={selectedIds.length === 0 || isSubmitting}
              >
                {isSubmitting
                  ? "追加中..."
                  : selectedIds.length === 0
                    ? "アイテムを選択"
                    : `${selectedIds.length}件を追加`}
              </Button>
            </>
          )}
        </>
      ) : (
        <form onSubmit={handleAddNew} className="space-y-4">
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

          {/* 追加ボタン */}
          <Button
            type="submit"
            className="w-full"
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? "追加中..." : "追加"}
          </Button>
        </form>
      )}
    </div>
  )
}
