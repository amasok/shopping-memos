"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Badge, BottomSheet, Button, EmptyState, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"
import { db, type ShoppingItem } from "@/lib/db"
import { getGroupsByUserId } from "@/lib/db/groups"
import { deleteHistory, revertHistoryToList } from "@/lib/db/lists"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { ChevronDown, ChevronUp, History, RotateCcw, ShoppingBag, Trash2, Users } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

function formatDate(date: Date): string {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"]
  const weekday = weekdays[date.getDay()]
  return `${month}/${day}（${weekday}）`
}

export default function HistoryPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { selectedGroupId, setSelectedGroupId } = useGroup()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // ログイン中の場合のみグループを取得
  const groups = useLiveQuery(
    async () => {
      if (!user) return []
      return getGroupsByUserId(user.id)
    },
    [user?.id]
  )

  // 選択されたグループで履歴をフィルタ
  const history = useLiveQuery(
    () => db.history.filter((h) => h.groupId === selectedGroupId).reverse().sortBy("purchasedAt"),
    [selectedGroupId]
  )

  // 購入済みアイテムを全て取得（選択されたグループでフィルタ）
  const purchasedItems = useLiveQuery(
    () => db.items.filter((item) => !!item.purchasedAt && item.groupId === selectedGroupId).toArray(),
    [selectedGroupId]
  )

  // タグを取得（選択されたグループでフィルタ）
  const tags = useLiveQuery(
    () => db.tags.filter((tag) => tag.groupId === selectedGroupId).toArray(),
    [selectedGroupId]
  )

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

  const handleRevertToList = async (historyId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsProcessing(true)
    try {
      const list = await revertHistoryToList(historyId)
      router.push(`/lists/${list.id}`)
    } catch (error) {
      console.error("Failed to revert history:", error)
      setIsProcessing(false)
    }
  }

  const handleDeleteHistory = async () => {
    if (!deleteTargetId) return
    setIsProcessing(true)
    try {
      await deleteHistory(deleteTargetId)
      setDeleteTargetId(null)
    } catch (error) {
      console.error("Failed to delete history:", error)
    } finally {
      setIsProcessing(false)
    }
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
        {/* グループ選択（ログイン時のみ） */}
        {user && groups && groups.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedGroupId(undefined)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
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
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
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
        )}

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
              // itemIdsからアイテムを取得
              const items = (record.itemIds ?? [])
                .map((id) => itemMap.get(id))
                .filter((item): item is ShoppingItem => item !== undefined)

              return (
                <li key={record.id}>
                  <div
                    className={cn(
                      "w-full rounded-xl bg-white p-4 shadow-sm text-left"
                    )}
                  >
                    {/* ヘッダー部分（クリックで展開/折りたたみ） */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : record.id)
                      }
                      className="w-full text-left transition-colors hover:opacity-80"
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
                    </button>

                    {isExpanded && (
                      <div className="mt-4 border-t border-gray-100 pt-4">
                        {/* アクションボタン */}
                        <div className="mb-4 flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1"
                            onClick={(e) => handleRevertToList(record.id, e)}
                            disabled={isProcessing || items.length === 0}
                          >
                            <RotateCcw className="mr-1 h-4 w-4" />
                            リストに戻す
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteTargetId(record.id)
                            }}
                            disabled={isProcessing}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* アイテム一覧 */}
                        <ul className="space-y-2">
                          {items.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-lg bg-gray-50 p-3 text-sm"
                            >
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
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </PageContainer>

      {/* 削除確認ダイアログ */}
      <BottomSheet
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title="履歴を削除"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            この購入履歴を削除しますか？
          </p>
          <p className="text-sm text-red-600">
            履歴に含まれるアイテムもすべて削除されます。
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setDeleteTargetId(null)}
              disabled={isProcessing}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteHistory}
              disabled={isProcessing}
            >
              {isProcessing ? "削除中..." : "削除する"}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </AppLayout>
  )
}
