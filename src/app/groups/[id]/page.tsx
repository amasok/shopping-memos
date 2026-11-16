"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { BottomSheet, Button, LoadingPage, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { type GroupMember } from "@/lib/db"
import { cn } from "@/lib/utils"
import { trpc } from "@/infrastructure/trpc/client"
import { useGroup } from "@/hooks/data"
import {
  Check,
  Copy,
  Crown,
  LogOut,
  MoreVertical,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  User,
  UserMinus,
  Users,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function GroupDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const groupId = params.id as string

  const [showMenu, setShowMenu] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState("")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showInviteSheet, setShowInviteSheet] = useState(false)
  const [isRegeneratingCode, setIsRegeneratingCode] = useState(false)
  const [isTogglingInvite, setIsTogglingInvite] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [removeMemberTarget, setRemoveMemberTarget] = useState<GroupMember | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // サーバーからグループとメンバーを取得
  const { group, members, isLoading: isGroupLoading, refetch: refetchGroup } = useGroup({ groupId })

  const isLoading = isGroupLoading
  // メンバー情報からオーナーかどうかを判定
  const myMembership = members?.find((m) => m.userId === user?.id)
  const isOwner = myMembership?.role === "owner"
  const inviteEnabled = group?.inviteEnabled ?? true

  // tRPC mutations
  const regenerateInviteCodeMutation = trpc.identity.regenerateInviteCode.useMutation({
    onSuccess: () => {
      refetchGroup()
    },
  })
  const setInviteEnabledMutation = trpc.identity.setInviteEnabled.useMutation({
    onSuccess: () => {
      refetchGroup()
    },
  })
  const updateGroupMutation = trpc.identity.updateGroup.useMutation({
    onSuccess: () => {
      refetchGroup()
    },
  })
  const deleteGroupMutation = trpc.identity.deleteGroup.useMutation()
  const removeMemberMutation = trpc.identity.removeMember.useMutation({
    onSuccess: () => {
      refetchGroup()
    },
  })

  useEffect(() => {
    if (group) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditName(group.name)
    }
  }, [group])

  const handleSaveName = async () => {
    if (!editName.trim()) return
    try {
      await updateGroupMutation.mutateAsync({ id: groupId, name: editName.trim() })
      setIsEditingName(false)
    } catch (error) {
      console.error("Failed to update group name:", error)
    }
  }

  const handleRegenerateCode = async () => {
    setIsRegeneratingCode(true)
    try {
      await regenerateInviteCodeMutation.mutateAsync({ groupId })
    } catch (error) {
      console.error("Failed to regenerate invite code:", error)
    } finally {
      setIsRegeneratingCode(false)
    }
  }

  const handleToggleInviteEnabled = async () => {
    if (!group) return
    setIsTogglingInvite(true)
    try {
      await setInviteEnabledMutation.mutateAsync({
        groupId,
        enabled: !inviteEnabled,
      })
    } catch (error) {
      console.error("Failed to toggle invite enabled:", error)
    } finally {
      setIsTogglingInvite(false)
    }
  }

  const handleCopyInviteCode = async () => {
    if (!group?.inviteCode) return
    await navigator.clipboard.writeText(group.inviteCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleShareInvite = async () => {
    if (!group?.inviteCode) return
    const shareText = `「${group.name}」に参加しませんか？\n招待コード: ${group.inviteCode}`
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText })
      } catch {
        // ユーザーがキャンセルした場合
      }
    } else {
      await navigator.clipboard.writeText(shareText)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    }
  }

  const handleDeleteGroup = async () => {
    setIsProcessing(true)
    try {
      await deleteGroupMutation.mutateAsync({ id: groupId })
      router.push("/groups")
    } catch (error) {
      console.error("Failed to delete group:", error)
      setIsProcessing(false)
    }
  }

  const handleLeaveGroup = async () => {
    if (!user) return
    setIsProcessing(true)
    try {
      // 自分自身を削除 = グループ退出
      await removeMemberMutation.mutateAsync({ groupId, userId: user.id })
      router.push("/groups")
    } catch (error) {
      console.error("Failed to leave group:", error)
      setIsProcessing(false)
    }
  }

  const handleRemoveMember = async () => {
    if (!removeMemberTarget) return
    setIsProcessing(true)
    try {
      await removeMemberMutation.mutateAsync({ groupId, userId: removeMemberTarget.userId })
      setRemoveMemberTarget(null)
    } catch (error) {
      console.error("Failed to remove member:", error)
    } finally {
      setIsProcessing(false)
    }
  }

  if (isLoading) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="グループ" showBackButton backHref="/groups" />
        <PageContainer>
          <LoadingPage />
        </PageContainer>
      </AppLayout>
    )
  }

  if (!group) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="グループ" showBackButton backHref="/groups" />
        <PageContainer>
          <div className="py-8 text-center">
            <p className="text-base text-gray-500">グループが見つかりません</p>
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  return (
    <AppLayout showBottomNav={false}>
      {/* カスタムヘッダー */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <button
            type="button"
            onClick={() => router.push("/groups")}
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
            aria-label="戻る"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {isEditingName ? (
            <div className="flex flex-1 items-center gap-2 px-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                data-testid="group-name-input"
                className={cn(
                  "flex-1 rounded-lg border-2 border-blue-500 px-3 py-1.5",
                  "text-base font-semibold text-gray-900",
                  "focus:outline-none"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleSaveName()
                  }
                  if (e.key === "Escape") {
                    setIsEditingName(false)
                    setEditName(group.name)
                  }
                }}
              />
              <Button size="sm" onClick={handleSaveName} data-testid="group-name-save">
                保存
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => isOwner && setIsEditingName(true)}
              className={cn(
                "flex items-center gap-1 text-lg font-semibold text-gray-900",
                isOwner && "hover:text-blue-600"
              )}
              disabled={!isOwner}
              data-testid="group-name"
            >
              {group.name}
              {isOwner && <Pencil className="h-4 w-4 text-gray-400" />}
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
              aria-label="メニュー"
              data-testid="group-menu-button"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      setShowInviteSheet(true)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Share2 className="h-4 w-4" />
                    メンバーを招待
                  </button>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false)
                        setShowDeleteConfirm(true)
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      data-testid="group-menu-delete"
                    >
                      <Trash2 className="h-4 w-4" />
                      グループを削除
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false)
                        setShowLeaveConfirm(true)
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      data-testid="group-menu-leave"
                    >
                      <LogOut className="h-4 w-4" />
                      グループから退出
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <PageContainer>
        <div className="space-y-6">
          {/* メンバー一覧 */}
          <section data-testid="group-members-section">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                <Users className="h-4 w-4" />
                メンバー ({members?.length ?? 0}人)
              </h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowInviteSheet(true)}
                disabled={!inviteEnabled}
              >
                <Share2 className="mr-1 h-4 w-4" />
                招待
              </Button>
            </div>
            <ul className="divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
              {members?.map((member) => {
                // サーバーからの型は user オブジェクトにネストされている
                const memberName = "user" in member ? member.user.name : (member as GroupMember).userName
                const memberEmail = "user" in member ? member.user.email : (member as GroupMember).userEmail
                return (
                  <li key={member.id} className="flex items-center justify-between p-4" data-testid={`group-member-${member.userId}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                        <User className="h-5 w-5 text-gray-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900">
                            {memberName}
                            {member.userId === user?.id && (
                              <span className="ml-1 text-sm font-normal text-gray-500">
                                (あなた)
                              </span>
                            )}
                          </p>
                          {member.role === "owner" && (
                            <Crown className="h-4 w-4 text-yellow-500" />
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{memberEmail}</p>
                      </div>
                    </div>
                    {isOwner && member.userId !== user?.id && (
                      <button
                        type="button"
                        onClick={() => setRemoveMemberTarget(member as GroupMember)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500"
                        aria-label="メンバーを削除"
                        data-testid="group-member-remove"
                      >
                        <UserMinus className="h-5 w-5" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          {/* 招待コード */}
          {isOwner && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                  招待コード
                </h2>
                <button
                  type="button"
                  role="switch"
                  aria-checked={inviteEnabled}
                  aria-label="招待を有効にする"
                  disabled={isTogglingInvite}
                  onClick={handleToggleInviteEnabled}
                  data-testid="group-invite-toggle"
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                    inviteEnabled ? "bg-blue-600" : "bg-gray-200",
                    isTogglingInvite && "opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      inviteEnabled ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
              <div className={cn("rounded-xl bg-white p-4 shadow-sm", !inviteEnabled && "opacity-50")}>
                <div className="mb-3 flex items-center justify-between">
                  <code className={cn("text-2xl font-bold tracking-widest", inviteEnabled ? "text-gray-900" : "text-gray-400")} data-testid="group-invite-code">
                    {group.inviteCode}
                  </code>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={handleCopyInviteCode}
                      disabled={!inviteEnabled}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full",
                        "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                      aria-label="コピー"
                      data-testid="group-invite-copy"
                    >
                      {copiedCode ? (
                        <Check className="h-5 w-5 text-green-600" />
                      ) : (
                        <Copy className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleRegenerateCode}
                      disabled={isRegeneratingCode || !inviteEnabled}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full",
                        "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                      aria-label="再生成"
                      data-testid="group-invite-regenerate"
                    >
                      <RefreshCw className={cn("h-5 w-5", isRegeneratingCode && "animate-spin")} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500">
                  {inviteEnabled
                    ? "このコードを共有して、家族をグループに招待しましょう"
                    : "招待が一時停止中です"}
                </p>
              </div>
            </section>
          )}
        </div>
      </PageContainer>

      {/* 招待シート */}
      <BottomSheet
        isOpen={showInviteSheet}
        onClose={() => setShowInviteSheet(false)}
        title="メンバーを招待"
      >
        <div className="space-y-4">
          {!inviteEnabled ? (
            <div className="rounded-lg bg-yellow-50 p-4 text-center">
              <p className="text-sm font-medium text-yellow-800">
                招待が一時停止中です
              </p>
              <p className="mt-1 text-sm text-yellow-600">
                オーナーが招待を再開するまでお待ちください
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-gray-50 p-4 text-center">
                <p className="mb-2 text-sm text-gray-500">招待コード</p>
                <code className="text-3xl font-bold tracking-widest text-gray-900">
                  {group.inviteCode}
                </code>
              </div>
              <p className="text-sm text-gray-600">
                招待コードを共有して、家族やパートナーをグループに招待しましょう。
                招待された人は「設定」→「グループ管理」から参加できます。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={handleCopyInviteCode}
                >
                  {copiedCode ? (
                    <>
                      <Check className="mr-2 h-5 w-5" />
                      コピーしました
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-5 w-5" />
                      コピー
                    </>
                  )}
                </Button>
                <Button className="flex-1" onClick={handleShareInvite}>
                  <Share2 className="mr-2 h-5 w-5" />
                  共有
                </Button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>

      {/* グループ削除確認 */}
      <BottomSheet
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="グループを削除"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            「{group.name}」を削除しますか？
          </p>
          <p className="text-sm text-red-600">
            この操作は取り消せません。すべてのメンバーがグループから削除されます。
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isProcessing}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteGroup}
              disabled={isProcessing}
              data-testid="group-delete-confirm"
            >
              {isProcessing ? "削除中..." : "削除する"}
            </Button>
          </div>
        </div>
      </BottomSheet>

      {/* 退出確認 */}
      <BottomSheet
        isOpen={showLeaveConfirm}
        onClose={() => setShowLeaveConfirm(false)}
        title="グループから退出"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            「{group.name}」から退出しますか？
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setShowLeaveConfirm(false)}
              disabled={isProcessing}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleLeaveGroup}
              disabled={isProcessing}
              data-testid="group-leave-confirm"
            >
              {isProcessing ? "退出中..." : "退出する"}
            </Button>
          </div>
        </div>
      </BottomSheet>

      {/* メンバー削除確認 */}
      <BottomSheet
        isOpen={removeMemberTarget !== null}
        onClose={() => setRemoveMemberTarget(null)}
        title="メンバーを削除"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            {removeMemberTarget?.userName}さんをグループから削除しますか？
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setRemoveMemberTarget(null)}
              disabled={isProcessing}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleRemoveMember}
              disabled={isProcessing}
              data-testid="group-remove-member-confirm"
            >
              {isProcessing ? "削除中..." : "削除する"}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </AppLayout>
  )
}
