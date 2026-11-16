"use client"

import { listDetailHref } from "@/lib/routes"
import { GroupSelector } from "@/components/features/groups/GroupSelector"
import { ItemSelector } from "@/components/features/items/ItemSelector"
import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Input, LoadingPage, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"
import { useGroups, useItems, useTags, useListMutations } from "@/hooks/data"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

function NewListPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlGroupId = searchParams.get("groupId")
  const { user } = useAuth()
  const { selectedGroupId: contextGroupId, setSelectedGroupId: setContextGroupId } = useGroup()

  const [listName, setListName] = useState("")
  // URLにgroupIdがある場合はそれを使用、なければContextの値を使用
  const [selectedGroupId, setSelectedGroupIdLocal] = useState<string | undefined>(
    urlGroupId ?? contextGroupId
  )

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

  // サーバーファースト対応のhooksを使用
  const { groups } = useGroups()
  const { items, isLoading: isItemsLoading } = useItems({ groupId: selectedGroupId, includePurchased: false })
  const { tags, isLoading: isTagsLoading } = useTags({ groupId: selectedGroupId })
  const { createList } = useListMutations()

  const isLoading = isItemsLoading || isTagsLoading

  // グループ変更時にデータを再取得
  const [prevGroupId, setPrevGroupId] = useState<string | undefined>(selectedGroupId)
  if (prevGroupId !== selectedGroupId) {
    setPrevGroupId(selectedGroupId)
  }

  const handleSubmit = async (data: {
    selectedItemIds: string[]
    newItems: { name: string; quantity: number; memo?: string; tagIds: string[] }[]
  }) => {
    // リストを作成（itemIdsを渡すと自動的にアイテムが追加される）
    const list = await createList({
      name: listName || "買い物リスト",
      groupId: selectedGroupId,
      itemIds: data.selectedItemIds,
    })

    // カタログアイテムは削除しない - リストから外した時に戻れるようにする

    // 新規アイテムがある場合はリスト詳細ページに遷移してから追加
    // (addNewItemToListはlistIdが必要なので、リスト作成後にリダイレクト)
    if (data.newItems.length > 0) {
      // 新規アイテム情報をsessionStorageに保存してリスト詳細ページで処理
      sessionStorage.setItem(
        `newListItems_${list?.id}`,
        JSON.stringify(data.newItems)
      )
    }

    router.push(listDetailHref(list?.id ?? ""))
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
            data-testid="list-name-input"
          />

          {/* アイテム選択 */}
          <div data-testid="item-selector">
          <ItemSelector
            existingItems={items ?? []}
            tags={tags ?? []}
            groupId={selectedGroupId}
            onSubmit={handleSubmit}
            submitLabel="リストを作成"
            submittingLabel="作成中..."
          />
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
