"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, Checkbox, Input, PageContainer } from "@/components/ui"
import { db } from "@/lib/db"
import { deleteItems } from "@/lib/db/items"
import { addListItems, createList } from "@/lib/db/lists"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { useRouter } from "next/navigation"
import { useState } from "react"

type Step = "tags" | "items"

export default function NewListPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("tags")
  const [listName, setListName] = useState("")
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [excludedItemIds, setExcludedItemIds] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  const items = useLiveQuery(() => db.items.orderBy("createdAt").reverse().toArray(), [])
  const tags = useLiveQuery(() => db.tags.orderBy("createdAt").toArray(), [])

  const isLoading = items === undefined || tags === undefined

  // タグでフィルタされたアイテム
  const filteredItems =
    selectedTagIds.length === 0
      ? items ?? []
      : (items ?? []).filter((item) =>
          item.tagIds.some((tagId) => selectedTagIds.includes(tagId))
        )

  // 選択されたアイテム（除外されていないもの）
  const selectedItems = filteredItems.filter(
    (item) => !excludedItemIds.includes(item.id)
  )

  const handleTagToggle = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
    // タグを変更したら除外リストをリセット
    setExcludedItemIds([])
  }

  const handleItemToggle = (itemId: string) => {
    setExcludedItemIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    )
  }

  const handleNextStep = () => {
    if (step === "tags") {
      setStep("items")
    }
  }

  const handleCreateList = async () => {
    if (selectedItems.length === 0) return

    setIsCreating(true)

    try {
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
      await deleteItems(selectedItems.map((item) => item.id))

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
            <p className="text-base text-gray-500">
              買いたいものがありません
            </p>
            <p className="mt-2 text-sm text-gray-400">
              まずはアイテムを追加してください
            </p>
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  return (
    <AppLayout showBottomNav={false}>
      <Header
        title={step === "tags" ? "リスト作成" : "アイテム選択"}
        showBackButton
        backHref={step === "tags" ? "/lists" : undefined}
      />
      <PageContainer>
        {step === "tags" ? (
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
                  含めるタグを選択
                </label>
                <p className="mb-3 text-sm text-gray-600">
                  選択したタグのアイテムがリストに追加されます
                </p>
                <div className="flex flex-wrap gap-2">
                  {tags?.map((tag) => {
                    const isSelected = selectedTagIds.includes(tag.id)
                    const itemCount = (items ?? []).filter((item) =>
                      item.tagIds.includes(tag.id)
                    ).length
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
                        <span className="ml-1 opacity-70">({itemCount})</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* プレビュー */}
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-sm text-gray-600">
                {selectedTagIds.length === 0
                  ? `すべてのアイテム（${items?.length ?? 0}件）がリストに追加されます`
                  : `${filteredItems.length}件のアイテムがリストに追加されます`}
              </p>
            </div>

            {/* 次へボタン */}
            <Button
              className="w-full"
              onClick={handleNextStep}
              disabled={filteredItems.length === 0}
            >
              次へ：アイテムを確認
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 説明 */}
            <p className="text-sm text-gray-600">
              リストに含めないアイテムのチェックを外してください
            </p>

            {/* アイテム一覧 */}
            <ul className="space-y-2">
              {filteredItems.map((item) => {
                const isIncluded = !excludedItemIds.includes(item.id)
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-lg bg-white p-3 shadow-sm",
                      !isIncluded && "opacity-50"
                    )}
                  >
                    <Checkbox
                      checked={isIncluded}
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

            {/* 作成ボタン */}
            <div className="space-y-3">
              <p className="text-center text-sm text-gray-600">
                {selectedItems.length}件のアイテムでリストを作成
              </p>
              <Button
                className="w-full"
                onClick={handleCreateList}
                disabled={selectedItems.length === 0 || isCreating}
              >
                {isCreating ? "作成中..." : "リストを作成して買い物開始"}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStep("tags")}
              >
                戻る
              </Button>
            </div>
          </div>
        )}
      </PageContainer>
    </AppLayout>
  )
}
