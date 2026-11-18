"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { safeCallbackPath } from "@/lib/auth/callbackUrl"
import { DisplayNameForm } from "./DisplayNameForm"

/**
 * 表示名の設定の画面（#61 A4。承認済みの文言）
 *
 * 表示名が入ったら（保存の後にセッションを取り直すと user.name が入る）、戻り先（同じオリジンのパスだけ）に移る。
 * ログインしていない人・表示名がある人が開いたときも、戻り先かホームに移る。「ログアウト」で抜けられる
 */
export function OnboardingView({ callbackUrl }: { callbackUrl: string | null }) {
  const { user, status, logout } = useAuth()
  const router = useRouter()
  const done = status !== "loading" && (!user || user.name !== "")

  useEffect(() => {
    if (done) router.replace(safeCallbackPath(callbackUrl, window.location.origin))
  }, [done, callbackUrl, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">表示名を決めてください</h1>
          <p className="mt-2 text-sm text-gray-600">グループのメンバー一覧に表示されます。あとから設定で変えられます</p>
        </div>
        <DisplayNameForm submitLabel="はじめる" />
        <button
          type="button"
          className="w-full text-center text-sm text-gray-600"
          onClick={() => void logout()}
          data-testid="onboarding-logout"
        >
          ログアウト
        </button>
      </div>
    </div>
  )
}
