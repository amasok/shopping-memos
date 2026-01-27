"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { Button, Checkbox, PageContainer } from "@/components/ui"
import { cn } from "@/lib/utils"
import { CheckCircle, ShoppingCart } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

// モックデータ
const mockListItems = [
  { id: "1", name: "牛乳", quantity: 1, checked: false },
  { id: "2", name: "食パン", quantity: 2, checked: false },
  { id: "3", name: "卵", quantity: 1, checked: true },
  { id: "4", name: "トマト", quantity: 3, checked: false },
  { id: "5", name: "洗剤", quantity: 1, checked: false },
]

interface ListItem {
  id: string
  name: string
  quantity: number
  checked: boolean
}

export default function ShoppingListPage() {
  const router = useRouter()
  const [items, setItems] = useState<ListItem[]>(mockListItems)
  const [isCompleting, setIsCompleting] = useState(false)

  const uncheckedItems = items.filter((item) => !item.checked)
  const checkedItems = items.filter((item) => item.checked)
  const progress = (checkedItems.length / items.length) * 100
  const allChecked = uncheckedItems.length === 0

  const handleToggle = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    )
  }

  const handleComplete = async () => {
    setIsCompleting(true)
    // TODO: APIで購入完了処理
    await new Promise((resolve) => setTimeout(resolve, 500))
    router.push("/history")
  }

  return (
    <AppLayout showBottomNav={false}>
      <Header title="買い物中" showBackButton backHref="/lists" />

      {/* プログレスバー */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-lg">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">進捗</span>
            <span className="font-semibold text-gray-900">
              {checkedItems.length}/{items.length}
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
                      onChange={() => handleToggle(item.id)}
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
                      onChange={() => handleToggle(item.id)}
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
