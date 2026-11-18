"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { OnboardingView } from "@/components/auth/OnboardingView"

function OnboardingWithParams() {
  const params = useSearchParams()
  return <OnboardingView callbackUrl={params.get("callbackUrl")} />
}

/** 表示名の設定（#61 A4）。表示名が空のログイン中のユーザーを OnboardingGate がここへ誘導する */
export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingWithParams />
    </Suspense>
  )
}
