"use client"

import { listDetailHref } from "@/lib/routes"
import { GroupSelector } from "@/components/features/groups/GroupSelector"
import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, EmptyState, LoadingPage, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"
import { cn } from "@/lib/utils"
import { ChevronRight, ClipboardList, Plus, ShoppingBag } from "lucide-react"
import Link from "next/link"
import { useGroups, useListsWithItems } from "@/hooks/data"

export default function ListsPage() {
  const { user } = useAuth()
  const { selectedGroupId, setSelectedGroupId } = useGroup()

  // サーバーファースト対応のhooksを使用
  const { groups, isLoading: isGroupsLoading } = useGroups()
  const { lists, listItems, isLoading: isListsLoading } = useListsWithItems({ status: "in_progress" })

  const isLoading = isListsLoading || (user && isGroupsLoading)

  // 各リストのアイテム数とチェック済み数を計算
  const listStats = new Map<string, { total: number; checked: number }>()
  if (listItems) {
    for (const item of listItems) {
      const stat = listStats.get(item.listId) ?? { total: 0, checked: 0 }
      stat.total++
      if (item.checked) stat.checked++
      listStats.set(item.listId, stat)
    }
  }

  if (isLoading) {
    return (
      <AppLayout>
        <Header title="買い物リスト" />
        <PageContainer>
          <LoadingPage />
        </PageContainer>
      </AppLayout>
    )
  }

  const hasActiveLists = (lists?.length ?? 0) > 0

  return (
    <AppLayout>
      <Header title="買い物リスト" />
      <PageContainer>
        {/* グループ選択（ログイン時のみ） */}
        {user && (
          <div className="mb-4">
            <GroupSelector
              selectedGroupId={selectedGroupId}
              groups={groups}
              onGroupChange={setSelectedGroupId}
            />
          </div>
        )}

        {!hasActiveLists ? (
          <EmptyState
            data-testid="lists-empty-state"
            icon={<ClipboardList className="h-16 w-16" />}
            title="進行中のリストがありません"
            description="買い物に行く時はリストを作成しましょう"
            action={
              <Link href={selectedGroupId ? `/lists/new?groupId=${selectedGroupId}` : "/lists/new"}>
                <Button data-testid="lists-create-button">
                  <Plus className="mr-2 h-5 w-5" />
                  リストを作成
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {/* 新規作成ボタン */}
            <Link href={selectedGroupId ? `/lists/new?groupId=${selectedGroupId}` : "/lists/new"}>
              <Button className="w-full" data-testid="lists-create-button">
                <Plus className="mr-2 h-5 w-5" />
                新しいリストを作成
              </Button>
            </Link>

            {/* 進行中のリスト */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-500">
                進行中
              </h2>
              <ul className="space-y-3" data-testid="lists-list">
                {lists?.map((list) => {
                  const stat = listStats.get(list.id) ?? { total: 0, checked: 0 }
                  return (
                    <li key={list.id}>
                      <Link
                        href={listDetailHref(list.id)}
                        data-testid={`list-item-${list.id}`}
                        className={cn(
                          "flex items-center justify-between rounded-xl bg-white p-4 shadow-sm",
                          "transition-colors hover:bg-gray-50"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                            <ShoppingBag className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">
                              {list.name}
                            </p>
                            <p className="text-sm text-gray-500">
                              {stat.checked}/{stat.total} 完了
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        )}
      </PageContainer>
    </AppLayout>
  )
}
