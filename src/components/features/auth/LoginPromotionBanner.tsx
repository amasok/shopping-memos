"use client"

import { useState, useCallback, useSyncExternalStore } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { Cloud, X } from "lucide-react"
import Link from "next/link"

const STORAGE_KEY = "login-promotion-dismissed"

function getSnapshot(): boolean {
  if (typeof window === "undefined") return true
  return localStorage.getItem(STORAGE_KEY) === "true"
}

function getServerSnapshot(): boolean {
  return true // SSR時は非表示
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback)
  return () => window.removeEventListener("storage", callback)
}

/**
 * ログイン促進バナー
 * 未ログインユーザーにログインのメリットを伝える
 */
export function LoginPromotionBanner() {
  const { user, isLoading } = useAuth()
  const isDismissedFromStorage = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [localDismissed, setLocalDismissed] = useState(false)

  const isDismissed = isDismissedFromStorage || localDismissed

  const handleDismiss = useCallback(() => {
    setLocalDismissed(true)
    localStorage.setItem(STORAGE_KEY, "true")
  }, [])

  // ログイン中、ローディング中、または非表示設定の場合は表示しない
  if (isLoading || user || isDismissed) {
    return null
  }

  return (
    <div
      className={cn(
        "fixed bottom-36 left-0 right-0 z-10",
        "mx-4"
      )}
    >
      <div className="relative rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 p-4 shadow-lg">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-2 top-2 rounded-full p-1 text-blue-200 hover:bg-blue-500 hover:text-white"
          aria-label="閉じる"
        >
          <X className="h-4 w-4" />
        </button>
        <Link href="/login" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500">
            <Cloud className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-white">
              ログインしてデバイス間で同期
            </p>
            <p className="text-sm text-blue-100">
              Googleアカウントで簡単ログイン
            </p>
          </div>
        </Link>
      </div>
    </div>
  )
}
