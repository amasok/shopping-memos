"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Badge, Button, Input, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { Minus, Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

// デフォルトのタグ
const defaultTags = ["食品", "日用品", "エンタメ"]

export default function NewItemPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [tags, setTags] = useState<string[]>(defaultTags)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => Math.max(1, prev + delta))
  }

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const handleAddTag = () => {
    const trimmed = newTagName.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed])
      setSelectedTags((prev) => [...prev, trimmed])
    }
    setNewTagName("")
    setIsAddingTag(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)

    // TODO: APIに保存する処理
    await new Promise((resolve) => setTimeout(resolve, 500))

    router.push("/")
  }

  const isValid = name.trim().length > 0

  return (
    <AppLayout showBottomNav={false}>
      <Header title="アイテムを追加" showBackButton backHref="/" />
      <PageContainer>
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* アイテム名 */}
          <Input
            label="アイテム名"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 牛乳"
            autoFocus
            autoComplete="off"
          />

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
              >
                <Minus className="h-5 w-5" strokeWidth={2.5} />
              </button>
              <span className="min-w-[56px] text-center text-3xl font-bold text-gray-900">
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
              >
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* タグ選択 */}
          <div>
            <label className="mb-2 block text-base font-semibold text-gray-900">
              タグ
            </label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = selectedTags.includes(tag)
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
                  </button>
                )
              })}
              {/* タグ追加ボタン */}
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

            {/* タグ追加フォーム */}
            {isAddingTag && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="新しいタグ名"
                  autoFocus
                  className={cn(
                    "flex-1 rounded-lg border-2 border-gray-300 px-3 py-2 text-sm",
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

            {selectedTags.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-gray-600">選択中:</span>
                <div className="flex flex-wrap gap-1">
                  {selectedTags.map((tag) => (
                    <Badge key={tag} variant="primary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 保存ボタン */}
          <div className="pt-4">
            <Button
              type="submit"
              className="w-full text-lg font-semibold"
              disabled={!isValid || isSubmitting}
            >
              {isSubmitting ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </PageContainer>
    </AppLayout>
  )
}
