"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { useAuth } from "@/contexts/AuthContext"
import { trpc } from "@/infrastructure/trpc/client"
import { displayNameSchema } from "@/shared/schemas/profile"

export const DISPLAY_NAME_SAVE_FAILED = "保存できませんでした。もう一度お試しください"

/**
 * 表示名の入力（#61 A4）。表示名の設定の画面と、設定画面の「表示名を変更」で共用する
 *
 * 検証は shared の displayNameSchema（サーバーと同じ）。保存したらセッションを取り直し、AuthContext の user.name を新しくする
 */
export function DisplayNameForm({
  initialName = "",
  submitLabel,
  onSaved,
}: {
  initialName?: string
  submitLabel: string
  onSaved?: (name: string) => void
}) {
  const { refresh } = useAuth()
  const updateProfile = trpc.identity.updateProfile.useMutation()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = displayNameSchema.safeParse(name)
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await updateProfile.mutateAsync({ name: parsed.data })
      await refresh()
      onSaved?.(saved.name)
    } catch {
      setError(DISPLAY_NAME_SAVE_FAILED)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Input
        label="表示名"
        name="displayName"
        autoComplete="nickname"
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="display-name-input"
        required
      />
      {error && (
        <p role="alert" className="text-sm font-semibold text-red-600" data-testid="display-name-error">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="display-name-submit">
        {submitLabel}
      </Button>
    </form>
  )
}
