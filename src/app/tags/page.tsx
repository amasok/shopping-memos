"use client"

import { GroupSelector } from "@/components/features/groups/GroupSelector"
import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { BottomSheet, Button, EmptyState, LoadingPage, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"
import { db, type Tag } from "@/lib/db"
import { getGroupsByUserId } from "@/lib/db/groups"
import { createTag, deleteTag, updateTag } from "@/lib/db/tags"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react"
import { useState } from "react"

export default function TagsPage() {
  const { user } = useAuth()
  const { selectedGroupId, setSelectedGroupId } = useGroup()
  const [isAdding, setIsAdding] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  // ログイン中の場合のみグループを取得
  const groups = useLiveQuery(
    async () => {
      if (!user) return []
      return getGroupsByUserId(user.id)
    },
    [user?.id]
  )

  // 選択されたグループでタグをフィルタ
  const tags = useLiveQuery(
    () => db.tags.filter((tag) => tag.groupId === selectedGroupId).toArray(),
    [selectedGroupId]
  )
  // 未購入アイテムのみカウント対象（選択されたグループでフィルタ）
  const items = useLiveQuery(
    () => db.items.filter((item) => !item.purchasedAt && item.groupId === selectedGroupId).toArray(),
    [selectedGroupId]
  )
  const isLoading = tags === undefined || items === undefined

  // タグごとのアイテム数をカウント
  const tagItemCounts = new Map<string, number>()
  if (tags && items) {
    for (const tag of tags) {
      const count = items.filter((item) => item.tagIds.includes(tag.id)).length
      tagItemCounts.set(tag.id, count)
    }
  }

  const handleAddTag = async () => {
    const trimmed = newTagName.trim()
    if (!trimmed) return

    // 重複チェック（同じグループ内で）
    const existing = tags?.find((t) => t.name === trimmed)
    if (existing) {
      setNewTagName("")
      setIsAdding(false)
      return
    }

    await createTag(trimmed, selectedGroupId)
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
          <LoadingPage />
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
          {/* グループ選択（ログイン時のみ） */}
          {user && (
            <GroupSelector
              selectedGroupId={selectedGroupId}
              groups={groups}
              onGroupChange={setSelectedGroupId}
              label="共有先グループ"
              size="md"
            />
          )}

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
              {tags?.map((tag) => {
                const itemCount = tagItemCounts.get(tag.id) ?? 0
                const isDeleting = deleteTarget === tag.id

                return (
                  <li
                    key={tag.id}
                    className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                        <TagIcon className="h-5 w-5 text-gray-600" />
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900">{tag.name}</span>
                        <span className="ml-2 text-sm text-gray-500">
                          ({itemCount}件)
                        </span>
                      </div>
                    </div>

                    {isDeleting ? (
                      <div className="flex flex-col items-end gap-2">
                        {itemCount > 0 && (
                          <p className="text-xs text-red-600">
                            {itemCount}件のアイテムに紐付いています
                          </p>
                        )}
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
                )
              })}
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

  // 前回のtag.idを追跡して変更時のみ更新（レンダリング中に同期）
  const [prevTagId, setPrevTagId] = useState<string | null>(null)
  if (tag && tag.id !== prevTagId) {
    setPrevTagId(tag.id)
    setName(tag.name)
  }

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
