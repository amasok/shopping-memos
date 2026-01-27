"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { BottomSheet, Button, EmptyState, PageContainer } from "@/components/ui"
import { db, type Tag } from "@/lib/db"
import { createTag, deleteTag, updateTag } from "@/lib/db/tags"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"

export default function TagsPage() {
  const [isAdding, setIsAdding] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const tags = useLiveQuery(() => db.tags.orderBy("createdAt").toArray(), [])
  const isLoading = tags === undefined

  const handleAddTag = async () => {
    const trimmed = newTagName.trim()
    if (!trimmed) return

    // 重複チェック
    const existing = tags?.find((t) => t.name === trimmed)
    if (existing) {
      setNewTagName("")
      setIsAdding(false)
      return
    }

    await createTag(trimmed)
    setNewTagName("")
    setIsAdding(false)
  }

  const handleDeleteTag = async (id: string) => {
    await deleteTag(id)
    setDeleteTarget(null)
  }

  const handleOpenEdit = (tag: Tag) => {
    setEditingTag(tag)
    setIsSheetOpen(true)
  }

  const handleCloseSheet = () => {
    setIsSheetOpen(false)
    setEditingTag(null)
  }

  if (isLoading) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="タグ管理" showBackButton backHref="/settings" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  const hasTags = (tags?.length ?? 0) > 0

  return (
    <AppLayout showBottomNav={false}>
      <Header title="タグ管理" showBackButton backHref="/settings" />
      <PageContainer>
        <div className="space-y-4">
          {/* 追加ボタン */}
          {!isAdding ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="mr-2 h-5 w-5" />
              タグを追加
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="新しいタグ名"
                autoFocus
                className={cn(
                  "flex-1 rounded-lg border-2 border-gray-300 px-4 py-3",
                  "text-base font-medium text-gray-900",
                  "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleAddTag()
                  }
                  if (e.key === "Escape") {
                    setIsAdding(false)
                    setNewTagName("")
                  }
                }}
              />
              <Button onClick={handleAddTag} disabled={!newTagName.trim()}>
                追加
              </Button>
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false)
                  setNewTagName("")
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
                aria-label="キャンセル"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* タグ一覧 */}
          {!hasTags ? (
            <EmptyState
              icon={<TagIcon className="h-16 w-16" />}
              title="タグがありません"
              description="タグを作ると買い物が便利になります"
            />
          ) : (
            <ul className="space-y-2">
              {tags?.map((tag) => (
                <li
                  key={tag.id}
                  className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                      <TagIcon className="h-5 w-5 text-gray-600" />
                    </div>
                    <span className="font-semibold text-gray-900">{tag.name}</span>
                  </div>

                  {deleteTarget === tag.id ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteTag(tag.id)}
                      >
                        削除
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(null)}
                      >
                        キャンセル
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(tag)}
                        className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-blue-500"
                        aria-label={`${tag.name}を編集`}
                      >
                        <Pencil className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(tag.id)}
                        className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-red-500"
                        aria-label={`${tag.name}を削除`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageContainer>

      {/* タグ編集ボトムシート */}
      <BottomSheet
        isOpen={isSheetOpen}
        onClose={handleCloseSheet}
        title="タグを編集"
      >
        <TagEditForm tag={editingTag} onClose={handleCloseSheet} />
      </BottomSheet>
    </AppLayout>
  )
}

// タグ編集フォーム
function TagEditForm({
  tag,
  onClose,
}: {
  tag: Tag | null
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (tag) {
      setName(tag.name)
    }
  }, [tag])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tag || !name.trim()) return

    setIsSubmitting(true)
    try {
      await updateTag(tag.id, name.trim())
      onClose()
    } catch (error) {
      console.error("Failed to update tag:", error)
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length > 0

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label
          htmlFor="tag-name"
          className="mb-2 block text-base font-semibold text-gray-900"
        >
          タグ名
        </label>
        <input
          id="tag-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className={cn(
            "w-full rounded-lg border-2 border-gray-300 px-4 py-3",
            "text-lg font-semibold text-gray-900",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          )}
        />
      </div>

      <Button
        type="submit"
        className="w-full text-lg font-semibold"
        disabled={!isValid || isSubmitting}
      >
        {isSubmitting ? "更新中..." : "更新"}
      </Button>
    </form>
  )
}
