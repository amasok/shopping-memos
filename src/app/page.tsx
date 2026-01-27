"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Badge, EmptyState, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { Plus, Search, ShoppingCart, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

// モックデータ（後でAPIから取得）
const mockItems = [
  { id: "1", name: "牛乳", quantity: 1, tags: ["食品"] },
  { id: "2", name: "食パン", quantity: 2, tags: ["食品"] },
  { id: "3", name: "卵", quantity: 1, tags: ["食品"] },
  { id: "4", name: "トマト", quantity: 3, tags: ["食品"] },
  { id: "5", name: "洗剤", quantity: 1, tags: ["日用品"] },
  { id: "6", name: "ティッシュ", quantity: 2, tags: ["日用品"] },
  { id: "7", name: "Netflix", quantity: 1, tags: ["エンタメ"] },
]

// タグ一覧を抽出
const allTags = Array.from(new Set(mockItems.flatMap((item) => item.tags)))

interface ShoppingItem {
  id: string
  name: string
  quantity: number
  tags: string[]
}

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const items: ShoppingItem[] = mockItems

  // フィルタリング
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      searchQuery === "" ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTag =
      selectedTag === null || item.tags.includes(selectedTag)
    return matchesSearch && matchesTag
  })

  const hasItems = items.length > 0
  const hasFilteredItems = filteredItems.length > 0

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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                  selectedTag === null
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                )}
              >
                すべて
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                    selectedTag === tag
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>

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
                  <li
                    key={item.id}
                    className="rounded-xl bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-lg font-semibold text-gray-900">
                          {item.name}
                        </p>
                        {item.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.tags.map((tag) => (
                              <Badge key={tag} variant="default">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {item.quantity > 1 && (
                        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-bold text-gray-700">
                          x{item.quantity}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PageContainer>

      {/* FAB（追加ボタン） */}
      <Link
        href="/items/new"
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
      </Link>
    </AppLayout>
  )
}
