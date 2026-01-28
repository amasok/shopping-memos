"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { BottomSheet, Button, EmptyState, Input, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { db, type Group } from "@/lib/db"
import { createGroup, getGroupsByUserId } from "@/lib/db/groups"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { ChevronRight, LogIn, Plus, Users } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

export default function GroupsPage() {
  const { user, isLoading: authLoading, login } = useAuth()
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // ユーザーが所属するグループを取得
  const groups = useLiveQuery(
    async () => {
      if (!user) return []
      return getGroupsByUserId(user.id)
    },
    [user?.id]
  )

  const isLoading = authLoading || groups === undefined

  const handleLogin = async () => {
    await login()
  }

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !newGroupName.trim()) return

    setIsCreating(true)
    try {
      await createGroup(newGroupName.trim(), user.id, user.name, user.email)
      setNewGroupName("")
      setIsCreateSheetOpen(false)
    } catch (error) {
      console.error("Failed to create group:", error)
    } finally {
      setIsCreating(false)
    }
  }

  // 未ログイン時はログイン促進画面
  if (!authLoading && !user) {
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
            <Button className="w-full max-w-xs" onClick={handleLogin}>
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

  if (isLoading) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="グループ管理" showBackButton backHref="/settings" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  const hasGroups = (groups?.length ?? 0) > 0

  return (
    <AppLayout showBottomNav={false}>
      <Header title="グループ管理" showBackButton backHref="/settings" />
      <PageContainer>
        <div className="space-y-4">
          {/* 作成ボタン */}
          <Button className="w-full" onClick={() => setIsCreateSheetOpen(true)}>
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
              {groups?.map((group) => (
                <GroupListItem key={group.id} group={group} />
              ))}
            </ul>
          )}
        </div>
      </PageContainer>

      {/* グループ作成シート */}
      <BottomSheet
        isOpen={isCreateSheetOpen}
        onClose={() => setIsCreateSheetOpen(false)}
        title="グループを作成"
      >
        <form onSubmit={handleCreateGroup} className="space-y-6">
          <Input
            label="グループ名"
            name="groupName"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="例: 田中家"
            autoFocus
          />
          <Button
            type="submit"
            className="w-full"
            disabled={!newGroupName.trim() || isCreating}
          >
            {isCreating ? "作成中..." : "作成"}
          </Button>
        </form>
      </BottomSheet>
    </AppLayout>
  )
}

function GroupListItem({ group }: { group: Group }) {
  // メンバー数を取得
  const members = useLiveQuery(
    () => db.groupMembers.where("groupId").equals(group.id).toArray(),
    [group.id]
  )

  const memberCount = members?.length ?? 0

  return (
    <li>
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
            <p className="font-semibold text-gray-900">{group.name}</p>
            <p className="text-sm text-gray-500">{memberCount}人のメンバー</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-400" />
      </Link>
    </li>
  )
}
