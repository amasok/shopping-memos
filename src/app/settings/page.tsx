"use client"

import { useState } from "react"
import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, ConfirmDialog, PageContainer } from "@/components/ui"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { ChevronRight, FileText, LogIn, LogOut, Shield, Tag, User, Users } from "lucide-react"
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

  return (
    <AppLayout>
      <Header title="設定" />
      <PageContainer>
        <div className="space-y-6">
          {/* ユーザー情報 or ログイン促進 */}
          {isLoading ? (
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-center py-4">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              </div>
            </div>
          ) : user ? (
            <div className="rounded-xl bg-white p-4 shadow-sm">
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
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                    <User className="h-6 w-6 text-blue-600" />
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
                onClick={handleLogoutClick}
              >
                <LogOut className="mr-2 h-5 w-5" />
                ログアウト
              </Button>
            </div>
          ) : (
            <div className="rounded-xl bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                  <LogIn className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-blue-900">
                    ログインして同期
                  </p>
                  <p className="mt-1 text-sm text-blue-700">
                    Googleアカウントでログインすると、デバイス間でデータを同期できます
                  </p>
                  <Button className="mt-3" size="sm" onClick={handleLogin}>
                    Googleでログイン
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 設定項目 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-500">
              設定
            </h2>
            <ul className="divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
              {settingItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
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
            <ul className="divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
              <li>
                <Link
                  href="/privacy"
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
