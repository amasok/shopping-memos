"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { ChevronRight, LogIn, Tag, Users } from "lucide-react"
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
  // TODO: 認証状態を取得
  const isLoggedIn = false

  return (
    <AppLayout>
      <Header title="設定" />
      <PageContainer>
        <div className="space-y-6">
          {/* ログイン促進バナー */}
          {!isLoggedIn && (
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
                  <Button className="mt-3" size="sm">
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
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-600">
                買い物メモ v0.1.0
              </p>
            </div>
          </section>
        </div>
      </PageContainer>
    </AppLayout>
  )
}
