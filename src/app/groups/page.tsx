"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, EmptyState, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { ChevronRight, LogIn, Plus, Users } from "lucide-react"
import Link from "next/link"

// モックデータ
const mockGroups = [
  {
    id: "1",
    name: "田中家",
    memberCount: 2,
  },
]

interface Group {
  id: string
  name: string
  memberCount: number
}

export default function GroupsPage() {
  // TODO: 認証状態を取得
  const isLoggedIn = false
  const groups: Group[] = isLoggedIn ? mockGroups : []

  // 未ログイン時はログイン促進画面
  if (!isLoggedIn) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="グループ管理" showBackButton backHref="/settings" />
        <PageContainer>
          <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100">
              <Users className="h-10 w-10 text-blue-600" />
            </div>
            <h2 className="mb-2 text-xl font-bold text-gray-900">
              家族と共有しよう
            </h2>
            <p className="mb-6 max-w-xs text-gray-600">
              グループを作成すると、家族やパートナーと買いたいものを共有できます
            </p>
            <Button className="w-full max-w-xs">
              <LogIn className="mr-2 h-5 w-5" />
              Googleでログイン
            </Button>
            <p className="mt-4 text-sm text-gray-500">
              ログインするとグループ機能が使えます
            </p>
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  const hasGroups = groups.length > 0

  return (
    <AppLayout showBottomNav={false}>
      <Header title="グループ管理" showBackButton backHref="/settings" />
      <PageContainer>
        <div className="space-y-4">
          {/* 作成ボタン */}
          <Button className="w-full">
            <Plus className="mr-2 h-5 w-5" />
            グループを作成
          </Button>

          {/* グループ一覧 */}
          {!hasGroups ? (
            <EmptyState
              icon={<Users className="h-16 w-16" />}
              title="グループがありません"
              description="グループを作成して家族を招待しましょう"
            />
          ) : (
            <ul className="space-y-3">
              {groups.map((group) => (
                <li key={group.id}>
                  <Link
                    href={`/groups/${group.id}`}
                    className={cn(
                      "flex items-center justify-between rounded-xl bg-white p-4 shadow-sm",
                      "transition-colors hover:bg-gray-50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
                        <Users className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          {group.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {group.memberCount}人のメンバー
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageContainer>
    </AppLayout>
  )
}
