"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { useDataMerge } from "@/contexts/DataMergeContext"
import { withCallbackUrl } from "@/lib/auth/callbackUrl"

export const ONBOARDING_PATH = "/onboarding"
/** 誘導しないパス（表示名の設定そのものと、オフラインのフォールバック） */
const SKIP_PATHS = [ONBOARDING_PATH, "/~offline"]

/**
 * 表示名が空のログイン中のユーザーを、表示名の設定の画面へ誘導する（#61 A4。design の D3）
 *
 * 誘導は画面だけで行う（表示名は表示のためだけの値で、API は空でも動く）。今の画面を戻り先にする。
 * ゲストのデータの取り込み（merge）が片づくまでは誘導しない。merge は終わると画面を読み込み直すので、
 * 先に誘導すると入れかけた表示名が消える
 */
export function OnboardingGate() {
  const { user, status } = useAuth()
  const { isMergeCompleted, error: mergeError } = useDataMerge()
  const mergeSettled = isMergeCompleted || mergeError !== null
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (status !== "authenticated" || !user || user.name !== "") return
    if (!mergeSettled || SKIP_PATHS.includes(pathname)) return
    const current = `${pathname}${window.location.search}`
    router.replace(withCallbackUrl(ONBOARDING_PATH, current))
  }, [status, user, pathname, router, mergeSettled])

  return null
}
