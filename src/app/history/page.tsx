"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Badge, EmptyState, PageContainer } from "@/components/ui"
import { db, type ShoppingItem } from "@/lib/db"
import { revertPurchasedItem } from "@/lib/db/items"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { ChevronDown, ChevronUp, History, ShoppingBag, Undo2 } from "lucide-react"
import { useState } from "react"

function formatDate(date: Date): string {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"]
  const weekday = weekdays[date.getDay()]
  return `${month}/${day}（${weekday}）`
}

export default function HistoryPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const history = useLiveQuery(
    () => db.history.orderBy("purchasedAt").reverse().toArray(),
    []
  )

  // 購入済みアイテムを全て取得
  const purchasedItems = useLiveQuery(
    () => db.items.filter((item) => !!item.purchasedAt).toArray(),
    []
  )

  // タグを取得
  const tags = useLiveQuery(() => db.tags.toArray(), [])

  const isLoading = history === undefined || purchasedItems === undefined || tags === undefined

  // アイテムIDからアイテムを引くマップ
  const itemMap = new Map<string, ShoppingItem>()
  if (purchasedItems) {
    for (const item of purchasedItems) {
      itemMap.set(item.id, item)
    }
  }

  // タグIDからタグ名を引くマップ
  const tagMap = new Map(tags?.map((tag) => [tag.id, tag]) ?? [])

  const handleRevertItem = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await revertPurchasedItem(itemId)
  }

  if (isLoading) {
    return (
      <AppLayout>
        <Header title="購入履歴" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  const hasHistory = (history?.length ?? 0) > 0

  return (
    <AppLayout>
      <Header title="購入履歴" />
      <PageContainer>
        {!hasHistory ? (
          <EmptyState
            icon={<History className="h-16 w-16" />}
            title="購入履歴がありません"
            description="買い物リストを完了すると記録されます"
          />
        ) : (
          <ul className="space-y-3">
            {history?.map((record) => {
              const isExpanded = expandedId === record.id
              // itemIdsからアイテムを取得（購入済みのもののみ）
              const items = (record.itemIds ?? [])
                .map((id) => itemMap.get(id))
                .filter((item): item is ShoppingItem => item !== undefined)

              return (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : record.id)
                    }
                    className={cn(
                      "w-full rounded-xl bg-white p-4 shadow-sm text-left",
                      "transition-colors hover:bg-gray-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                          <ShoppingBag className="h-5 w-5 text-gray-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">
                            {record.location || "買い物"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatDate(record.purchasedAt)} · {record.itemIds?.length ?? 0}点
                          </p>
                          {!isExpanded && items.length > 0 && (
                            <p className="mt-1 text-sm text-gray-400">
                              {items
                                .slice(0, 3)
                                .map((item) => item.name)
                                .join("、")}
                              {items.length > 3 && " ..."}
                            </p>
                          )}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="mt-2 h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="mt-2 h-5 w-5 text-gray-400" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-4 border-t border-gray-100 pt-4">
                        <p className="mb-2 text-xs text-gray-400">
                          タップで「買いたいもの」に戻す
                        </p>
                        <ul className="space-y-2">
                          {items.map((item) => (
                            <li
                              key={item.id}
                              onClick={(e) => handleRevertItem(item.id, e)}
                              className={cn(
                                "rounded-lg bg-gray-50 p-3 text-sm",
                                "cursor-pointer transition-colors hover:bg-orange-50"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-gray-700">{item.name}</span>
                                    {item.quantity > 1 && (
                                      <span className="text-gray-500">
                                        x{item.quantity}
                                      </span>
                                    )}
                                  </div>
                                  {item.memo && (
                                    <p className="mt-0.5 text-xs text-gray-400">{item.memo}</p>
                                  )}
                                  {item.tagIds.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
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
                                <Undo2 className="ml-2 h-4 w-4 flex-shrink-0 text-orange-500" />
                              </div>
                            </li>
                          ))}
                          {/* 戻されたアイテム（itemMapにないもの）を表示 */}
                          {(record.itemIds ?? []).filter((id) => !itemMap.has(id)).length > 0 && (
                            <li className="text-xs text-gray-400 italic">
                              {(record.itemIds ?? []).filter((id) => !itemMap.has(id)).length}件は「買いたいもの」に戻されました
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PageContainer>
    </AppLayout>
  )
}
