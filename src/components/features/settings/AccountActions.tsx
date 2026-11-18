"use client"

import { useState } from "react"
import { LogOut, Pencil } from "lucide-react"
import { BottomSheet, Button, ConfirmDialog } from "@/components/ui"
import { DisplayNameForm } from "@/components/auth/DisplayNameForm"
import { useAuth } from "@/contexts/AuthContext"

/**
 * 設定画面のアカウント欄の操作（#61 A4。承認済みの文言）
 *
 * - 表示名を変更: ボトムシートで入力する（初回の設定と同じ検証）
 * - すべての端末からログアウト: 確認の後に、この端末を含むすべてのセッションを無効にする。失敗したら知らせる
 * メールアドレスは表示だけ（変える操作は置かない）
 */
export function AccountActions() {
  const { user, logoutAllDevices } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingLogoutAll, setIsConfirmingLogoutAll] = useState(false)
  const [logoutAllFailed, setLogoutAllFailed] = useState(false)

  return (
    <>
      <Button
        variant="secondary"
        className="mt-4 w-full"
        data-testid="change-display-name-button"
        onClick={() => setIsEditing(true)}
      >
        <Pencil className="mr-2 h-5 w-5" />
        表示名を変更
      </Button>
      <Button
        variant="ghost"
        className="mt-2 w-full text-red-600 hover:bg-red-50 hover:text-red-700"
        data-testid="logout-all-devices-button"
        onClick={() => setIsConfirmingLogoutAll(true)}
      >
        <LogOut className="mr-2 h-5 w-5" />
        すべての端末からログアウト
      </Button>
      {logoutAllFailed && (
        <p role="alert" className="mt-2 text-sm text-red-600" data-testid="logout-all-devices-error">
          ログアウトできませんでした。通信を確かめてもう一度お試しください
        </p>
      )}

      <BottomSheet isOpen={isEditing} onClose={() => setIsEditing(false)} title="表示名を変更">
        {isEditing && (
          <DisplayNameForm initialName={user?.name ?? ""} submitLabel="保存" onSaved={() => setIsEditing(false)} />
        )}
      </BottomSheet>

      <ConfirmDialog
        isOpen={isConfirmingLogoutAll}
        onClose={() => setIsConfirmingLogoutAll(false)}
        onConfirm={() => {
          setIsConfirmingLogoutAll(false)
          setLogoutAllFailed(false)
          logoutAllDevices().catch(() => setLogoutAllFailed(true))
        }}
        title="すべての端末からログアウト"
        message="すべての端末からログアウトしますか？この端末も含めて、もう一度メールのコードでログインが必要になります"
        confirmLabel="ログアウトする"
        cancelLabel="キャンセル"
        confirmVariant="danger"
      />
    </>
  )
}
