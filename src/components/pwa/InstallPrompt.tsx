"use client"

import { Button } from "@/components/ui"
import { useInstallPrompt } from "@/hooks/useInstallPrompt"
import { Download, Share, Smartphone } from "lucide-react"

export function InstallPrompt() {
  const { canInstall, isInstalled, isIOS, install } = useInstallPrompt()

  if (isInstalled) return null

  // iOS: show manual instructions
  if (isIOS) {
    return (
      <div
        className="rounded-xl p-4"
        style={{ backgroundColor: "var(--theme-primary-light)" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--theme-accent-light)" }}
          >
            <Smartphone className="h-5 w-5" style={{ color: "var(--theme-primary)" }} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-gray-900">
              ホーム画面に追加
            </p>
            <p className="mt-1 text-sm text-gray-600">
              <Share className="mr-1 inline h-4 w-4 align-text-bottom" />
              共有ボタンから「ホーム画面に追加」を選択すると、アプリのように使えます
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Android/Chrome: show install button
  if (!canInstall) return null

  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--theme-primary-light)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--theme-accent-light)" }}
        >
          <Download className="h-5 w-5" style={{ color: "var(--theme-primary)" }} />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">
            アプリをインストール
          </p>
          <p className="mt-1 text-sm text-gray-600">
            ホーム画面に追加して、アプリのように使えます
          </p>
          <Button className="mt-3" size="sm" onClick={install}>
            インストール
          </Button>
        </div>
      </div>
    </div>
  )
}
