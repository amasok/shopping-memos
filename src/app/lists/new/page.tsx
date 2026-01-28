"use client"

import { GroupSelector } from "@/components/features/groups/GroupSelector"
import { MultiTagFilter } from "@/components/features/tags/TagFilter"
import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, Checkbox, Input, LoadingPage, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"
import { db } from "@/lib/db"
import { getGroupsByUserId } from "@/lib/db/groups"
import { deleteItems } from "@/lib/db/items"
import { addListItems, createList } from "@/lib/db/lists"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

function NewListPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialItemId = searchParams.get("itemId")
  const urlGroupId = searchParams.get("groupId")
  const { user } = useAuth()
  const { selectedGroupId: contextGroupId, setSelectedGroupId: setContextGroupId } = useGroup()

  const [listName, setListName] = useState("")
  // URLにgroupIdがある場合はそれを使用、なければContextの値を使用
  const [selectedGroupId, setSelectedGroupIdLocal] = useState<string | undefined>(
    urlGroupId ?? contextGroupId
  )
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  // グループ変更時にContextも更新
  const setSelectedGroupId = (groupId: string | undefined) => {
    setSelectedGroupIdLocal(groupId)
    setContextGroupId(groupId)
  }

  // URLパラメータがある場合、Contextも同期
  useEffect(() => {
    if (urlGroupId !== null) {
      setContextGroupId(urlGroupId === "undefined" ? undefined : urlGroupId)
    }
  }, [urlGroupId, setContextGroupId])

  // 未購入アイテムのみ表示（選択されたグループでフィルタ）
  const items = useLiveQuery(
    () => db.items.orderBy("createdAt").reverse().filter((item) => !item.purchasedAt && item.groupId === selectedGroupId).toArray(),
    [selectedGroupId]
  )
  // タグはグループ選択時も個人タグ（共通）を含めて表示
  const tags = useLiveQuery(
    () => db.tags.filter((tag) =>
      tag.groupId === selectedGroupId || (selectedGroupId !== undefined && tag.groupId === undefined)
    ).toArray(),
    [selectedGroupId]
  )

  // ログイン中の場合のみグループを取得
  const groups = useLiveQuery(
    async () => {
      if (!user) return []
      return getGroupsByUserId(user.id)
    },
    [user?.id]
  )

  const isLoading = items === undefined || tags === undefined

  // グループ変更時にタグ選択とアイテム選択をリセット（レンダリング中に同期）
  const [prevGroupId, setPrevGroupId] = useState<string | undefined>(selectedGroupId)
  if (prevGroupId !== selectedGroupId) {
    setPrevGroupId(selectedGroupId)
    setSelectedTagIds([])
    setSelectedItemIds([])
  }

  // 初期アイテム選択（長押しから来た場合）- レンダリング中に同期
  const [initialized, setInitialized] = useState(false)
  if (!initialized && items && initialItemId) {
    const itemExists = items.some((item) => item.id === initialItemId)
    if (itemExists) {
      setSelectedItemIds([initialItemId])
    }
    setInitialized(true)
  }

  // タグでフィルタされたアイテム
  const filteredItems =
    selectedTagIds.length === 0
      ? items ?? []
      : (items ?? []).filter((item) =>
          item.tagIds.some((tagId) => selectedTagIds.includes(tagId))
        )

  // タグごとのアイテム数
  const tagItemCounts = new Map<string, number>()
  if (items && tags) {
    for (const tag of tags) {
      const count = items.filter((item) => item.tagIds.includes(tag.id)).length
      tagItemCounts.set(tag.id, count)
    }
  }

  const handleTagToggle = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    )
  }

  const handleItemToggle = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    )
  }

  const handleSelectAllVisible = () => {
    const visibleIds = filteredItems.map((item) => item.id)
    setSelectedItemIds((prev) => {
      const newIds = new Set(prev)
      for (const id of visibleIds) {
        newIds.add(id)
      }
      return Array.from(newIds)
    })
  }

  const handleDeselectAllVisible = () => {
    const visibleIds = new Set(filteredItems.map((item) => item.id))
    setSelectedItemIds((prev) => prev.filter((id) => !visibleIds.has(id)))
  }

  const handleCreateList = async () => {
    if (selectedItemIds.length === 0) return

    setIsCreating(true)

    try {
      const selectedItems = (items ?? []).filter((item) =>
        selectedItemIds.includes(item.id)
      )

      // リストを作成（グループIDを紐付け）
      const list = await createList(listName || undefined, selectedGroupId)

      // アイテムをリストに追加（タグ・メモ・グループを保持）
      await addListItems(
        list.id,
        selectedItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          memo: item.memo,
          tagIds: item.tagIds,
          groupId: item.groupId,
        }))
      )

      // 買いたいものから選択されたアイテムを削除
      await deleteItems(selectedItemIds)

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
          <LoadingPage />
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
            <p className="text-base text-gray-500">買いたいものがありません</p>
            <p className="mt-2 text-sm text-gray-400">
              まずはアイテムを追加してください
            </p>
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  // 表示中のアイテムで選択されているもの
  const visibleSelectedCount = filteredItems.filter((item) =>
    selectedItemIds.includes(item.id)
  ).length
  const allVisibleSelected = visibleSelectedCount === filteredItems.length

  return (
    <AppLayout showBottomNav={false}>
      <Header title="リスト作成" showBackButton backHref="/lists" />
      <PageContainer>
        <div className="space-y-6">
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

          {/* リスト名 */}
          <Input
            label="リスト名（任意）"
            name="listName"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="例: スーパーで買い物"
          />

          {/* タグで絞り込み */}
          <MultiTagFilter
            tags={tags}
            selectedTagIds={selectedTagIds}
            onTagToggle={handleTagToggle}
            onClearAll={() => setSelectedTagIds([])}
            tagItemCounts={tagItemCounts}
            label="タグで絞り込み"
            size="md"
            disableEmpty
          />

          {/* 一括選択ボタン */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={handleSelectAllVisible}
              disabled={allVisibleSelected || filteredItems.length === 0}
            >
              表示中をすべて選択
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={handleDeselectAllVisible}
              disabled={visibleSelectedCount === 0}
            >
              表示中をすべて解除
            </Button>
          </div>

          {/* アイテム一覧 */}
          <div>
            <label className="mb-2 block text-base font-semibold text-gray-900">
              アイテムを選択
              <span className="ml-2 font-normal text-gray-500">
                ({selectedItemIds.length}件選択中 / 表示{filteredItems.length}件)
              </span>
            </label>
            {filteredItems.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-gray-500">
                  該当するアイテムがありません
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredItems.map((item) => {
                  const isSelected = selectedItemIds.includes(item.id)
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "rounded-lg bg-white p-3 shadow-sm",
                        !isSelected && "opacity-50"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
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
            )}
          </div>

          {/* 作成ボタン */}
          <div className="space-y-3 pt-2">
            <Button
              className="w-full"
              onClick={handleCreateList}
              disabled={selectedItemIds.length === 0 || isCreating}
            >
              {isCreating
                ? "作成中..."
                : selectedItemIds.length === 0
                  ? "アイテムを選択してください"
                  : `${selectedItemIds.length}件でリストを作成`}
            </Button>
          </div>
        </div>
      </PageContainer>
    </AppLayout>
  )
}

export default function NewListPage() {
  return (
    <Suspense
      fallback={
        <AppLayout showBottomNav={false}>
          <Header title="リスト作成" showBackButton backHref="/lists" />
          <PageContainer>
            <LoadingPage />
          </PageContainer>
        </AppLayout>
      }
    >
      <NewListPageContent />
    </Suspense>
  )
}
