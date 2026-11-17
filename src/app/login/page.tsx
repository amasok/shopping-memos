"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ShoppingCart } from "lucide-react"
import { LoginForm } from "@/components/auth/LoginForm"

function LoginWithParams() {
  const params = useSearchParams()
  return <LoginForm callbackUrl={params.get("callbackUrl")} />
}

/** ログイン画面（#61 A3a 4.3）。メールアドレスとワンタイムコードでログインする */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
            <ShoppingCart className="h-8 w-8 text-white" />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">買い物メモ</h1>
          <p className="mt-2 text-sm text-gray-600">家族と買い物リストを共有しよう</p>
        </div>

        <Suspense fallback={null}>
          <LoginWithParams />
        </Suspense>

        <p className="text-center text-xs text-gray-500">ログインすることで、複数デバイス間でデータを同期できます</p>
      </div>
    </div>
  )
}
