"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, Checkbox, Input, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useState } from "react"

// モックデータ
const mockItems = [
  { id: "1", name: "牛乳", quantity: 1, tags: ["食品"] },
  { id: "2", name: "食パン", quantity: 2, tags: ["食品"] },
  { id: "3", name: "卵", quantity: 1, tags: ["食品"] },
  { id: "4", name: "トマト", quantity: 3, tags: ["食品"] },
  { id: "5", name: "洗剤", quantity: 1, tags: ["日用品"] },
  { id: "6", name: "ティッシュ", quantity: 2, tags: ["日用品"] },
  { id: "7", name: "Netflix", quantity: 1, tags: ["エンタメ"] },
]

const allTags = ["食品", "日用品", "エンタメ"]

type Step = "tags" | "items"

export default function NewListPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("tags")
  const [listName, setListName] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [excludedItemIds, setExcludedItemIds] = useState<string[]>([])

  // タグでフィルタされたアイテム
  const filteredItems =
    selectedTags.length === 0
      ? mockItems
      : mockItems.filter((item) =>
          item.tags.some((tag) => selectedTags.includes(tag))
        )

  // 選択されたアイテム（除外されていないもの）
  const selectedItems = filteredItems.filter(
    (item) => !excludedItemIds.includes(item.id)
  )

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
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

  const handleCreateList = () => {
    // TODO: APIでリストを作成
    router.push("/lists/1") // モックのリストIDに遷移
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
            <div>
              <label className="mb-2 block text-base font-semibold text-gray-900">
                含めるタグを選択
              </label>
              <p className="mb-3 text-sm text-gray-600">
                選択したタグのアイテムがリストに追加されます
              </p>
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => {
                  const isSelected = selectedTags.includes(tag)
                  const itemCount = mockItems.filter((item) =>
                    item.tags.includes(tag)
                  ).length
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleTagToggle(tag)}
                      className={cn(
                        "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                        isSelected
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      )}
                    >
                      {tag}
                      <span className="ml-1 opacity-70">({itemCount})</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* プレビュー */}
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-sm text-gray-600">
                {selectedTags.length === 0
                  ? `すべてのアイテム（${mockItems.length}件）がリストに追加されます`
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
                disabled={selectedItems.length === 0}
              >
                リストを作成して買い物開始
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
