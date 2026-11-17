"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { BottomSheet, Button, EmptyState, Input, LoadingPage, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { trpc } from "@/infrastructure/trpc/client"
import { useGroups } from "@/hooks/data"
import { ChevronRight, LogIn, Plus, UserPlus, Users } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

export default function GroupsPage() {
  const { user, isLoading: authLoading, login } = useAuth()
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [isJoinSheetOpen, setIsJoinSheetOpen] = useState(false)
  const [inviteCode, setInviteCode] = useState("")
  const [isJoining, setIsJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  // ユーザーが所属するグループを取得（サーバーから）
  const { groups, isLoading: isGroupsLoading, refetch: refetchGroups } = useGroups()

  const isLoading = authLoading || isGroupsLoading

  const handleLogin = async () => {
    await login()
  }

  const createGroupMutation = trpc.identity.createGroup.useMutation()

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !newGroupName.trim()) return

    setIsCreating(true)
    try {
      // サーバーでグループを作成
      await createGroupMutation.mutateAsync({
        name: newGroupName.trim(),
      })

      // 最新のグループ一覧を取り直す（フラグ true なら同期して所属グループのキャッシュを更新する。#62 O7）
      // 以前はゲスト DB にも書いていたが、ログイン中はどこからも読まれないのでやめた
      await refetchGroups()

      setNewGroupName("")
      setIsCreateSheetOpen(false)
    } catch (error) {
      console.error("Failed to create group:", error)
    } finally {
      setIsCreating(false)
    }
  }

  const joinGroupMutation = trpc.identity.joinByInviteCode.useMutation()

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !inviteCode.trim()) return

    setIsJoining(true)
    setJoinError(null)
    try {
      // サーバーでグループに参加
      await joinGroupMutation.mutateAsync({
        inviteCode: inviteCode.trim(),
      })

      // 最新のグループ一覧を取り直す（フラグ true なら同期して所属グループのキャッシュを更新する。#62 O7）
      await refetchGroups()

      setInviteCode("")
      setIsJoinSheetOpen(false)
    } catch (error) {
      console.error("Failed to join group:", error)
      if (error instanceof Error) {
        // tRPCエラーメッセージを表示
        setJoinError(error.message)
      } else {
        setJoinError("参加に失敗しました")
      }
    } finally {
      setIsJoining(false)
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
              ログイン
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
          <LoadingPage />
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
          {/* 作成・参加ボタン */}
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => setIsCreateSheetOpen(true)} data-testid="group-create-button">
              <Plus className="mr-2 h-5 w-5" />
              作成
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setIsJoinSheetOpen(true)}
              data-testid="group-join-button"
            >
              <UserPlus className="mr-2 h-5 w-5" />
              参加
            </Button>
          </div>

          {/* グループ一覧 */}
          {!hasGroups ? (
            <EmptyState
              icon={<Users className="h-16 w-16" />}
              title="グループがありません"
              description="グループを作成して家族を招待しましょう"
              data-testid="groups-empty-state"
            />
          ) : (
            <ul className="space-y-3" data-testid="groups-list">
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
            data-testid="group-create-name-input"
          />
          <Button
            type="submit"
            className="w-full"
            disabled={!newGroupName.trim() || isCreating}
            data-testid="group-create-submit"
          >
            {isCreating ? "作成中..." : "作成"}
          </Button>
        </form>
      </BottomSheet>

      {/* グループ参加シート */}
      <BottomSheet
        isOpen={isJoinSheetOpen}
        onClose={() => {
          setIsJoinSheetOpen(false)
          setInviteCode("")
          setJoinError(null)
        }}
        title="グループに参加"
      >
        <form onSubmit={handleJoinGroup} className="space-y-6">
          <div>
            <Input
              label="招待コード"
              name="inviteCode"
              value={inviteCode}
              onChange={(e) => {
                setInviteCode(e.target.value.toUpperCase())
                setJoinError(null)
              }}
              placeholder="例: ABCD2345"
              autoFocus
              maxLength={8}
              data-testid="group-join-code-input"
            />
            <p className="mt-2 text-sm text-gray-500">
              グループの管理者から共有されたコード（8文字）を入力してください
            </p>
            {joinError && (
              <p className="mt-2 text-sm text-red-600" data-testid="group-join-error">{joinError}</p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={inviteCode.trim().length < 6 || isJoining}
            data-testid="group-join-submit"
          >
            {isJoining ? "参加中..." : "参加"}
          </Button>
        </form>
      </BottomSheet>
    </AppLayout>
  )
}

function GroupListItem({ group }: { group: { id: string; name: string; memberCount: number } }) {
  return (
    <li data-testid={`group-item-${group.id}`}>
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
            <p className="text-sm text-gray-500">{group.memberCount}人のメンバー</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-400" />
      </Link>
    </li>
  )
}
