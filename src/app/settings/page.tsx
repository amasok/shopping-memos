"use client"

import { useState } from "react"
import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, ConfirmDialog, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme, THEMES, type ThemeType } from "@/contexts/ThemeContext"
import { InstallPrompt } from "@/components/pwa/InstallPrompt"
import { cn } from "@/lib/utils"
import { Check, ChevronRight, FileText, LogIn, LogOut, Palette, Shield, Tag, User, Users } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

interface SettingItem {
  icon: React.ReactNode
  label: string
  description?: string
  href: string
}

const settingItems: SettingItem[] = [
  {
    icon: <Tag className="h-5 w-5" />,
    label: "タグ管理",
    description: "タグの追加・編集・削除",
    href: "/tags",
  },
  {
    icon: <Users className="h-5 w-5" />,
    label: "グループ管理",
    description: "家族やパートナーと共有",
    href: "/groups",
  },
]

export default function SettingsPage() {
  const { user, isLoading, login, logout } = useAuth()
  const { theme, setTheme, isHydrated } = useTheme()
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false)

  const handleLogin = async () => {
    await login()
  }

  const handleLogoutClick = () => {
    setIsLogoutDialogOpen(true)
  }

  const handleLogoutConfirm = async () => {
    await logout()
  }

  const handleThemeChange = (newTheme: ThemeType) => {
    setTheme(newTheme)
  }

  return (
    <AppLayout>
      <Header title="設定" />
      <PageContainer>
        <div className="space-y-6" data-testid="settings-page">
          {/* ユーザー情報 or ログイン促進 */}
          {isLoading ? (
            <div className="rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-center justify-center py-4">
                <div
                  className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: "var(--theme-primary)", borderTopColor: "transparent" }}
                />
              </div>
            </div>
          ) : user ? (
            <div className="rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                {user.avatarUrl ? (
                  <Image
                    src={user.avatarUrl}
                    alt={user.name}
                    width={48}
                    height={48}
                    className="h-12 w-12 rounded-full"
                  />
                ) : (
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: "var(--theme-primary-light)" }}
                  >
                    <User className="h-6 w-6" style={{ color: "var(--theme-primary)" }} />
                  </div>
                )}
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{user.name}</p>
                  <p className="text-sm text-gray-500">{user.email}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                className="mt-4 w-full text-red-600 hover:bg-red-50 hover:text-red-700"
                data-testid="logout-button"
                onClick={handleLogoutClick}
              >
                <LogOut className="mr-2 h-5 w-5" />
                ログアウト
              </Button>
            </div>
          ) : (
            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: "var(--theme-primary-light)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: "var(--theme-accent-light)" }}
                >
                  <LogIn className="h-5 w-5" style={{ color: "var(--theme-primary)" }} />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">
                    ログインして同期
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Googleアカウントでログインすると、デバイス間でデータを同期できます
                  </p>
                  <Button className="mt-3" size="sm" data-testid="login-button" onClick={handleLogin}>
                    Googleでログイン
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* アプリインストール */}
          <InstallPrompt />


          {/* テーマ設定 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-500">
              テーマ
            </h2>
            <div className="rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: "var(--theme-primary-light)" }}
                >
                  <Palette className="h-5 w-5" style={{ color: "var(--theme-primary)" }} />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">カラーテーマ</p>
                  <p className="text-sm text-gray-500">アプリの配色を変更</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {THEMES.map((t) => {
                  // ハイドレーション後のみ選択状態を表示（SSRとの不一致を防ぐ）
                  const isSelected = isHydrated && theme === t.id
                  return (
                    <button
                      key={t.id}
                      data-testid={`theme-${t.id}`}
                      onClick={() => handleThemeChange(t.id)}
                      className={cn(
                        "relative flex items-center gap-3 rounded-xl p-3 transition-all",
                        "border-2",
                        isSelected
                          ? "border-gray-900 bg-gray-50"
                          : "border-gray-200 hover:border-gray-300"
                      )}
                    >
                      <div
                        className="h-8 w-8 rounded-full shadow-inner"
                        style={{ backgroundColor: t.color }}
                      />
                      <div className="text-left">
                        <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                        <p className="text-xs text-gray-500">{t.description}</p>
                      </div>
                      {isSelected && (
                        <div
                          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full"
                          style={{ backgroundColor: t.color }}
                        >
                          <Check className="h-3 w-3 text-white" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* 設定項目 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-500">
              設定
            </h2>
            <ul className="divide-y divide-gray-100 rounded-xl bg-card shadow-sm">
              {settingItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-testid={`settings-${item.href.slice(1)}-link`}
                    className={cn(
                      "flex items-center justify-between p-4",
                      "transition-colors hover:bg-gray-50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                        {item.icon}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          {item.label}
                        </p>
                        {item.description && (
                          <p className="text-sm text-gray-500">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* アプリ情報 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-500">
              アプリ情報
            </h2>
            <ul className="divide-y divide-gray-100 rounded-xl bg-card shadow-sm">
              <li>
                <Link
                  href="/privacy"
                  data-testid="settings-privacy-link"
                  className={cn(
                    "flex items-center justify-between p-4",
                    "transition-colors hover:bg-gray-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                      <Shield className="h-5 w-5" />
                    </div>
                    <p className="font-semibold text-gray-900">
                      プライバシーポリシー
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  data-testid="settings-terms-link"
                  className={cn(
                    "flex items-center justify-between p-4",
                    "transition-colors hover:bg-gray-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <p className="font-semibold text-gray-900">
                      利用規約
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </Link>
              </li>
              <li className="p-4">
                <p className="text-sm text-gray-600">
                  買い物メモ v0.1.0
                </p>
              </li>
            </ul>
          </section>
        </div>
      </PageContainer>

      <ConfirmDialog
        isOpen={isLogoutDialogOpen}
        onClose={() => setIsLogoutDialogOpen(false)}
        onConfirm={handleLogoutConfirm}
        title="ログアウト"
        message="ログアウトしますか？ローカルデータは保持されます。"
        confirmLabel="ログアウト"
        cancelLabel="キャンセル"
        confirmVariant="danger"
      />
    </AppLayout>
  )
}
