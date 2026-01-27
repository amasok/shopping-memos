"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, EmptyState, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { ChevronRight, ClipboardList, Plus, ShoppingBag } from "lucide-react"
import Link from "next/link"

// モックデータ
const mockLists = [
  {
    id: "1",
    name: "スーパーで買い物",
    itemCount: 5,
    checkedCount: 2,
    status: "in_progress" as const,
    createdAt: "2024-01-28",
  },
]

interface ShoppingList {
  id: string
  name: string
  itemCount: number
  checkedCount: number
  status: "in_progress" | "completed"
  createdAt: string
}

export default function ListsPage() {
  const lists: ShoppingList[] = mockLists
  const activeLists = lists.filter((list) => list.status === "in_progress")
  const hasActiveLists = activeLists.length > 0

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
                {activeLists.map((list) => (
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
                            {list.checkedCount}/{list.itemCount} 完了
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </PageContainer>
    </AppLayout>
  )
}
