"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { BottomSheet, Button, Checkbox, PageContainer } from "@/components/ui"
import { db } from "@/lib/db"
import {
  addListItem,
  deleteListItem,
  finishShopping,
  toggleListItem,
} from "@/lib/db/lists"
import { cn } from "@/lib/utils"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCircle, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"

export default function ShoppingListPage() {
  const params = useParams()
  const router = useRouter()
  const listId = params.id as string
  const [isCompleting, setIsCompleting] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false)

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

  const handleDelete = async (id: string) => {
    await deleteListItem(id)
    setDeleteTargetId(null)
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
            <p className="text-base text-gray-500">リストが見つかりません</p>
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
                    className="flex items-center gap-2 rounded-lg bg-white p-4 shadow-sm"
                  >
                    <div className="flex-1">
                      <Checkbox
                        checked={item.checked}
                        onChange={() => handleToggle(item.id, item.checked)}
                        label={
                          item.quantity > 1
                            ? `${item.name} x${item.quantity}`
                            : item.name
                        }
                      />
                    </div>
                    {deleteTargetId === item.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(item.id)}
                        >
                          削除
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTargetId(null)}
                        >
                          戻す
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(item.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-red-500"
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
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
                    className="flex items-center gap-2 rounded-lg bg-white/50 p-4"
                  >
                    <div className="flex-1">
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
                    </div>
                    {deleteTargetId === item.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(item.id)}
                        >
                          削除
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTargetId(null)}
                        >
                          戻す
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(item.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-red-500"
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* アイテムがない場合 */}
          {(items?.length ?? 0) === 0 && (
            <div className="py-8 text-center">
              <p className="text-base text-gray-500">
                アイテムがありません
              </p>
              <p className="mt-2 text-sm text-gray-400">
                下の「+」ボタンから追加できます
              </p>
            </div>
          )}

          {/* 完了ボタン */}
          {allChecked && (items?.length ?? 0) > 0 && (
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

          {!allChecked && (items?.length ?? 0) > 0 && (
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

      {/* アイテム追加ボタン（FAB） */}
      <button
        type="button"
        onClick={() => setIsAddSheetOpen(true)}
        className={cn(
          "fixed bottom-6 right-4 z-20",
          "flex h-14 w-14 items-center justify-center",
          "rounded-full bg-blue-600 text-white shadow-lg",
          "transition-transform hover:scale-105 active:scale-95",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        )}
        aria-label="アイテムを追加"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* アイテム追加ボトムシート */}
      <BottomSheet
        isOpen={isAddSheetOpen}
        onClose={() => setIsAddSheetOpen(false)}
        title="アイテムを追加"
      >
        <AddItemForm
          listId={listId}
          onClose={() => setIsAddSheetOpen(false)}
        />
      </BottomSheet>
    </AppLayout>
  )
}

// アイテム追加フォーム
function AddItemForm({
  listId,
  onClose,
}: {
  listId: string
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => Math.max(1, prev + delta))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)
    try {
      await addListItem(listId, name.trim(), quantity)
      setName("")
      setQuantity(1)
      onClose()
    } catch (error) {
      console.error("Failed to add item:", error)
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length > 0

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* アイテム名 */}
      <div>
        <label
          htmlFor="item-name"
          className="mb-2 block text-base font-semibold text-gray-900"
        >
          アイテム名
        </label>
        <input
          id="item-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 牛乳"
          autoFocus
          autoComplete="off"
          className={cn(
            "w-full rounded-lg border-2 border-gray-300 px-4 py-3",
            "text-lg font-semibold text-gray-900",
            "placeholder:font-normal placeholder:text-gray-400",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          )}
        />
      </div>

      {/* 数量 */}
      <div>
        <label className="mb-2 block text-base font-semibold text-gray-900">
          数量
        </label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => handleQuantityChange(-1)}
            disabled={quantity <= 1}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              "border-2 border-gray-300 text-gray-700",
              "transition-colors hover:bg-gray-100",
              "disabled:border-gray-200 disabled:text-gray-300"
            )}
            aria-label="数量を減らす"
          >
            <Minus className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <span className="min-w-[56px] text-center text-3xl font-bold text-gray-900">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => handleQuantityChange(1)}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              "border-2 border-gray-300 text-gray-700",
              "transition-colors hover:bg-gray-100"
            )}
            aria-label="数量を増やす"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* 追加ボタン */}
      <Button
        type="submit"
        className="w-full text-lg font-semibold"
        disabled={!isValid || isSubmitting}
      >
        {isSubmitting ? "追加中..." : "追加"}
      </Button>
    </form>
  )
}
