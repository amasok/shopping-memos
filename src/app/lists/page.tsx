"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, EmptyState, PageContainer } from "@/components/ui"
import { db } from "@/lib/db"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { ChevronRight, ClipboardList, Plus, ShoppingBag } from "lucide-react"
import Link from "next/link"

export default function ListsPage() {
  const lists = useLiveQuery(
    () => db.lists.where("status").equals("in_progress").toArray(),
    []
  )
  const listItems = useLiveQuery(() => db.listItems.toArray(), [])

  const isLoading = lists === undefined || listItems === undefined

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
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  const hasActiveLists = (lists?.length ?? 0) > 0

  return (
    <AppLayout>
      <Header title="買い物リスト" />
      <PageContainer>
        {!hasActiveLists ? (
          <EmptyState
            icon={<ClipboardList className="h-16 w-16" />}
            title="進行中のリストがありません"
            description="買い物に行く時はリストを作成しましょう"
            action={
              <Link href="/lists/new">
                <Button>
                  <Plus className="mr-2 h-5 w-5" />
                  リストを作成
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {/* 新規作成ボタン */}
            <Link href="/lists/new">
              <Button className="w-full">
                <Plus className="mr-2 h-5 w-5" />
                新しいリストを作成
              </Button>
            </Link>

            {/* 進行中のリスト */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-500">
                進行中
              </h2>
              <ul className="space-y-3">
                {lists?.map((list) => {
                  const stat = listStats.get(list.id) ?? { total: 0, checked: 0 }
                  return (
                    <li key={list.id}>
                      <Link
                        href={`/lists/${list.id}`}
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
