"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { useOnlineStatus } from "@/hooks/useOnlineStatus"
import { authClient } from "@/infrastructure/auth/client"
import { safeCallbackPath } from "@/lib/auth/callbackUrl"
import { normalizeEmail } from "@/shared/schemas/email"
import { LOGIN_MESSAGES, otpErrorMessage } from "./otpMessages"
import { useTurnstile } from "./useTurnstile"

/** 再送信できるまでの秒数（サーバーの再送の間隔と同じ） */
export const RESEND_COOLDOWN_SECONDS = 60
const TURNSTILE_TOKEN_HEADER = "x-turnstile-token"

type Step = { kind: "email" } | { kind: "code"; email: string }

/**
 * メールアドレスとワンタイムコードでのログイン（#61 A3a 4.3）
 *
 * メールアドレス → コードの 2 段階。コードの送信には非表示の Turnstile のトークンを付ける。
 * ログインに成功したら、戻り先（同じオリジンのパスだけ）を読み込み直す（ゲストのデータの取り込みは DataMergeContext が行う）
 */
export function LoginForm({ callbackUrl }: { callbackUrl: string | null }) {
  const online = useOnlineStatus()
  const { containerRef, getToken } = useTurnstile()
  const [step, setStep] = useState<Step>({ kind: "email" })
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendCode(target: string) {
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp(
        { email: target, type: "sign-in" },
        { headers: { [TURNSTILE_TOKEN_HEADER]: token ?? "" } }
      )
      if (sendError) {
        setError(otpErrorMessage(sendError))
        return
      }
      setStep({ kind: "code", email: target })
      setOtp("")
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      setError(LOGIN_MESSAGES.unknown)
    } finally {
      setBusy(false)
    }
  }

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeEmail(email)
    if (!normalized) {
      setError(LOGIN_MESSAGES.invalidEmail)
      return
    }
    await sendCode(normalized)
  }

  async function handleCodeSubmit(event: FormEvent) {
    event.preventDefault()
    if (step.kind !== "code") return
    setBusy(true)
    setError(null)
    try {
      const { error: signInError } = await authClient.signIn.emailOtp({ email: step.email, otp: otp.trim() })
      if (signInError) {
        setError(otpErrorMessage(signInError))
        return
      }
      window.location.assign(safeCallbackPath(callbackUrl, window.location.origin))
    } catch {
      setError(LOGIN_MESSAGES.unknown)
    } finally {
      setBusy(false)
    }
  }

  const disabled = !online || busy

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900" data-testid="login-migration-notice">
        {LOGIN_MESSAGES.migration}
      </p>

      {!online && (
        <p role="alert" className="text-sm font-semibold text-red-600" data-testid="login-offline">
          {LOGIN_MESSAGES.offline}
        </p>
      )}

      {step.kind === "email" ? (
        <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
          <Input
            label="メールアドレス"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
            required
          />
          <Button type="submit" size="lg" className="w-full" disabled={disabled} data-testid="login-send-code">
            コードを送信
          </Button>
        </form>
      ) : (
        <form onSubmit={handleCodeSubmit} className="space-y-4" noValidate>
          <p className="text-sm text-gray-700" data-testid="login-code-sent">
            {step.email} に 6 桁のコードを送信しました
          </p>
          <Input
            label="コード"
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            data-testid="login-otp"
            required
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={disabled || otp.length !== 6}
            data-testid="login-submit"
          >
            ログイン
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-blue-600 disabled:text-gray-400"
              disabled={disabled || cooldown > 0}
              onClick={() => void sendCode(step.email)}
              data-testid="login-resend"
            >
              {cooldown > 0 ? `再送信（${cooldown}秒後に有効）` : "再送信"}
            </button>
            <button
              type="button"
              className="text-gray-600"
              onClick={() => {
                setStep({ kind: "email" })
                setError(null)
              }}
              data-testid="login-change-email"
            >
              メールアドレスを変更
            </button>
          </div>
          <p className="text-xs text-gray-500">コードが届かないときは、迷惑メールのフォルダも確認してください</p>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-red-600" data-testid="login-error">
          {error}
        </p>
      )}
      <div ref={containerRef} />
    </div>
  )
}
