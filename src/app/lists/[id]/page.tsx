"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, Checkbox, PageContainer } from "@/components/ui"
import { db } from "@/lib/db"
import { finishShopping, toggleListItem } from "@/lib/db/lists"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCircle, ShoppingCart } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"

export default function ShoppingListPage() {
  const params = useParams()
  const router = useRouter()
  const listId = params.id as string
  const [isCompleting, setIsCompleting] = useState(false)

  const list = useLiveQuery(() => db.lists.get(listId), [listId])
  const items = useLiveQuery(
    () => db.listItems.where("listId").equals(listId).toArray(),
    [listId]
  )

  const isLoading = list === undefined || items === undefined

  const uncheckedItems = (items ?? []).filter((item) => !item.checked)
  const checkedItems = (items ?? []).filter((item) => item.checked)
  const progress =
    items && items.length > 0 ? (checkedItems.length / items.length) * 100 : 0
  const allChecked = uncheckedItems.length === 0 && (items?.length ?? 0) > 0

  const handleToggle = async (id: string, checked: boolean) => {
    await toggleListItem(id, !checked)
  }

  const handleComplete = async () => {
    setIsCompleting(true)
    try {
      await finishShopping(listId, list?.name)
      router.push("/history")
    } catch (error) {
      console.error("Failed to complete shopping:", error)
      setIsCompleting(false)
    }
  }

  if (isLoading) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="買い物中" showBackButton backHref="/lists" />
        <PageContainer>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  if (!list) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="買い物中" showBackButton backHref="/lists" />
        <PageContainer>
          <div className="py-8 text-center">
            <p className="text-base text-gray-500">
              リストが見つかりません
            </p>
          </div>
        </PageContainer>
      </AppLayout>
    )
  }

  return (
    <AppLayout showBottomNav={false}>
      <Header title={list.name || "買い物中"} showBackButton backHref="/lists" />

      {/* プログレスバー */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-lg">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">進捗</span>
            <span className="font-semibold text-gray-900">
              {checkedItems.length}/{items?.length ?? 0}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <PageContainer>
        <div className="space-y-6">
          {/* 未チェックのアイテム */}
          {uncheckedItems.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-500">
                <ShoppingCart className="h-4 w-4" />
                買うもの
              </h2>
              <ul className="space-y-2">
                {uncheckedItems.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg bg-white p-4 shadow-sm"
                  >
                    <Checkbox
                      checked={item.checked}
                      onChange={() => handleToggle(item.id, item.checked)}
                      label={
                        item.quantity > 1
                          ? `${item.name} x${item.quantity}`
                          : item.name
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* チェック済みのアイテム */}
          {checkedItems.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-500">
                <CheckCircle className="h-4 w-4" />
                カゴに入れた
              </h2>
              <ul className="space-y-2">
                {checkedItems.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg bg-white/50 p-4"
                  >
                    <Checkbox
                      checked={item.checked}
                      onChange={() => handleToggle(item.id, item.checked)}
                      strikethrough
                      label={
                        item.quantity > 1
                          ? `${item.name} x${item.quantity}`
                          : item.name
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 完了ボタン */}
          {allChecked && (
            <div
              className={cn(
                "rounded-xl bg-green-50 p-4 text-center",
                "border-2 border-green-200"
              )}
            >
              <CheckCircle className="mx-auto mb-2 h-12 w-12 text-green-600" />
              <p className="mb-4 font-semibold text-green-800">
                すべてカゴに入れました！
              </p>
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={handleComplete}
                disabled={isCompleting}
              >
                {isCompleting ? "処理中..." : "購入完了"}
              </Button>
            </div>
          )}

          {!allChecked && (
            <div className="pt-4">
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleComplete}
                disabled={isCompleting || checkedItems.length === 0}
              >
                {checkedItems.length === 0
                  ? "カゴに入れたものがありません"
                  : `${checkedItems.length}件を購入完了にする`}
              </Button>
              <p className="mt-2 text-center text-sm text-gray-500">
                チェックしていないアイテムは「買いたいもの」に戻ります
              </p>
            </div>
          )}
        </div>
      </PageContainer>
    </AppLayout>
  )
}
