"use client"

import { ItemForm } from "@/components/ItemForm"
import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Badge, BottomSheet, EmptyState, PageContainer } from "@/components/ui"
import { db, type ShoppingItem } from "@/lib/db"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus, Search, ShoppingCart, X } from "lucide-react"
import { useState } from "react"

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null)

  const items = useLiveQuery(() => db.items.orderBy("createdAt").reverse().toArray(), [])
  const tags = useLiveQuery(() => db.tags.orderBy("createdAt").toArray(), [])

  const isLoading = items === undefined || tags === undefined

  // タグIDからタグ名を取得するマップ
  const tagMap = new Map(tags?.map((tag) => [tag.id, tag]) ?? [])

  // フィルタリング
  const filteredItems = (items ?? []).filter((item) => {
    const matchesSearch =
      searchQuery === "" ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTag =
      selectedTagId === null || item.tagIds.includes(selectedTagId)
    return matchesSearch && matchesTag
  })

  const hasItems = (items?.length ?? 0) > 0
  const hasFilteredItems = filteredItems.length > 0

  const handleOpenAdd = () => {
    setEditingItem(null)
    setIsSheetOpen(true)
  }

  const handleOpenEdit = (item: ShoppingItem) => {
    setEditingItem(item)
    setIsSheetOpen(true)
  }

  const handleCloseSheet = () => {
    setIsSheetOpen(false)
    setEditingItem(null)
  }

  if (isLoading) {
    return (
      <AppLayout>
        <Header title="買いたいもの" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <Header title="買いたいもの" />
      <PageContainer>
        {!hasItems ? (
          <EmptyState
            icon={<ShoppingCart className="h-16 w-16" />}
            title="買いたいものがありません"
            description="右下の+ボタンから追加しましょう"
          />
        ) : (
          <div className="space-y-4">
            {/* 検索バー */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="検索..."
                className={cn(
                  "w-full rounded-lg border-2 border-gray-200 bg-white py-3 pl-10 pr-10",
                  "text-base font-medium text-gray-900",
                  "placeholder:text-gray-400",
                  "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                )}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="検索をクリア"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* タグフィルター */}
            {(tags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTagId(null)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                    selectedTagId === null
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  )}
                >
                  すべて
                </button>
                {tags?.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setSelectedTagId(tag.id === selectedTagId ? null : tag.id)
                    }
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                      selectedTagId === tag.id
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            )}

            {/* アイテム一覧 */}
            {!hasFilteredItems ? (
              <div className="py-8 text-center">
                <p className="text-base text-gray-500">
                  該当するアイテムがありません
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {filteredItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(item)}
                      className={cn(
                        "w-full rounded-xl bg-white p-4 shadow-sm text-left",
                        "transition-colors hover:bg-gray-50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="text-lg font-semibold text-gray-900">
                            {item.name}
                          </p>
                          {item.tagIds.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.tagIds.map((tagId) => {
                                const tag = tagMap.get(tagId)
                                return tag ? (
                                  <Badge key={tagId} variant="default">
                                    {tag.name}
                                  </Badge>
                                ) : null
                              })}
                            </div>
                          )}
                        </div>
                        {item.quantity > 1 && (
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-bold text-gray-700">
                            x{item.quantity}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PageContainer>

      {/* FAB（追加ボタン） */}
      <button
        type="button"
        onClick={handleOpenAdd}
        className={cn(
          "fixed bottom-20 right-4 z-20",
          "flex h-14 w-14 items-center justify-center",
          "rounded-full bg-blue-600 text-white shadow-lg",
          "transition-transform hover:scale-105 active:scale-95",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        )}
        aria-label="アイテムを追加"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* アイテム追加/編集ボトムシート */}
      <BottomSheet
        isOpen={isSheetOpen}
        onClose={handleCloseSheet}
        title={editingItem ? "アイテムを編集" : "アイテムを追加"}
      >
        <ItemForm
          item={editingItem}
          onClose={handleCloseSheet}
        />
      </BottomSheet>
    </AppLayout>
  )
}
