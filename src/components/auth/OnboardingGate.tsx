"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { withCallbackUrl } from "@/lib/auth/callbackUrl"

export const ONBOARDING_PATH = "/onboarding"
/** 誘導しないパス（表示名の設定そのものと、オフラインのフォールバック） */
const SKIP_PATHS = [ONBOARDING_PATH, "/~offline"]

/**
 * 表示名が空のログイン中のユーザーを、表示名の設定の画面へ誘導する（#61 A4。design の D3）
 *
 * 誘導は画面だけで行う（表示名は表示のためだけの値で、API は空でも動く）。今の画面を戻り先にする
 */
export function OnboardingGate() {
  const { user, status } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (status !== "authenticated" || !user || user.name !== "") return
    if (SKIP_PATHS.includes(pathname)) return
    const current = `${pathname}${window.location.search}`
    router.replace(withCallbackUrl(ONBOARDING_PATH, current))
  }, [status, user, pathname, router])

  return null
}
