"use client"

import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { ItemSelector, type NewItemInput } from "@/components/features/items/ItemSelector"
import { MemoText } from "@/components/features/items/MemoText"
import { BottomSheet, Button, Checkbox, LoadingPage, PageContainer, SwipeToRemove } from "@/components/ui"
import { cn } from "@/lib/utils"
import { useList, useItems, useTags, useListMutations } from "@/hooks/data"
import {
  CheckCircle,
  MoreVertical,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState, useEffect } from "react"

export default function ShoppingListPage() {
  const params = useParams()
  const router = useRouter()
  const listId = params.id as string
  const [isCompleting, setIsCompleting] = useState(false)
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState("")
  const [showMenu, setShowMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteItemHandling, setDeleteItemHandling] = useState<"return" | "delete">("return")
  const [showEmptyListConfirm, setShowEmptyListConfirm] = useState(false)

  // サーバーファースト対応のhooksを使用
  const { list, items: listItems, isLoading: isListLoading, refetch: refetchList } = useList({ listId })

  // リストのgroupIdを取得（null → undefined に変換）
  const listGroupId = list?.groupId ?? undefined

  // 買いたいもの一覧（リストに追加するため）- 未購入のみ、リストと同じグループのみ
  const { items, isLoading: isItemsLoading } = useItems({ groupId: listGroupId, includePurchased: false })
  // タグ一覧（リストと同じグループ）
  const { tags, isLoading: isTagsLoading } = useTags({ groupId: listGroupId })

  // ミューテーション
  const { checkItem, removeItemFromList, addItemToList, addNewItemToList, updateList, deleteList, finishShopping } = useListMutations()

  const isLoading = isListLoading || isItemsLoading || isTagsLoading

  // sessionStorageから新規アイテムを追加（リスト作成画面から遷移してきた場合）
  useEffect(() => {
    const storageKey = `newListItems_${listId}`
    const stored = sessionStorage.getItem(storageKey)
    if (stored) {
      sessionStorage.removeItem(storageKey)
      const newItems: NewItemInput[] = JSON.parse(stored)

      // 非同期で新規アイテムを追加
      const addItems = async () => {
        for (const item of newItems) {
          await addNewItemToList({
            listId,
            name: item.name,
            quantity: item.quantity,
            memo: item.memo,
            tagIds: item.tagIds,
          })
        }
        refetchList()
      }
      addItems()
    }
  }, [listId, addNewItemToList, refetchList])

  // リスト名編集の初期化（listが変わった時のみ同期）
  const [prevListName, setPrevListName] = useState<string | undefined>(undefined)
  if (list && !isEditingName && list.name !== prevListName) {
    setPrevListName(list.name)
    setEditName(list.name)
  }

  const uncheckedItems = (listItems ?? []).filter((item) => !item.checked)
  const checkedItems = (listItems ?? []).filter((item) => item.checked)
  const progress =
    listItems && listItems.length > 0
      ? (checkedItems.length / listItems.length) * 100
      : 0
  const allChecked =
    uncheckedItems.length === 0 && (listItems?.length ?? 0) > 0

  const handleToggle = async (id: string, checked: boolean) => {
    await checkItem(id, !checked)
    refetchList()
  }

  const handleRemove = async (id: string) => {
    await removeItemFromList(id)
    refetchList()

    // 空になったかチェック（更新後のデータで確認）
    const remainingCount = (listItems?.length ?? 1) - 1
    if (remainingCount === 0) {
      setShowEmptyListConfirm(true)
    }
  }

  const handleSaveName = async () => {
    if (!editName.trim()) return
    await updateList({ id: listId, name: editName.trim() })
    refetchList()
    setIsEditingName(false)
  }

  const handleDeleteList = async () => {
    await deleteList(listId)
    router.push("/lists")
  }

  const handleDeleteEmptyList = async () => {
    await deleteList(listId)
    router.push("/lists")
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

  const handleAddItems = async (data: {
    selectedItemIds: string[]
    newItems: NewItemInput[]
  }) => {
    // 既存アイテムをリストに追加（スナップショットを作成）
    // カタログアイテムは削除しない - リストから外した時に戻れるようにする
    for (const itemId of data.selectedItemIds) {
      await addItemToList({ listId, itemId })
    }

    // 新規アイテムをリストに追加
    for (const item of data.newItems) {
      await addNewItemToList({
        listId,
        name: item.name,
        quantity: item.quantity,
        memo: item.memo,
        tagIds: item.tagIds,
      })
    }

    refetchList()
    setIsAddSheetOpen(false)
  }

  if (isLoading) {
    return (
      <AppLayout showBottomNav={false}>
        <Header title="買い物中" showBackButton backHref="/lists" />
        <PageContainer>
          <LoadingPage />
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
      {/* カスタムヘッダー（編集可能） */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <button
            type="button"
            onClick={() => router.push("/lists")}
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
            aria-label="戻る"
            data-testid="back-button"
          >
            <X className="h-5 w-5" />
          </button>

          {isEditingName ? (
            <div className="flex flex-1 items-center gap-2 px-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                data-testid="list-name-input"
                className={cn(
                  "flex-1 rounded-lg border-2 border-blue-500 px-3 py-1.5",
                  "text-base font-semibold text-gray-900",
                  "focus:outline-none"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleSaveName()
                  }
                  if (e.key === "Escape") {
                    setIsEditingName(false)
                    setEditName(list.name)
                  }
                }}
              />
              <Button size="sm" onClick={handleSaveName} data-testid="list-name-save">
                保存
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="flex items-center gap-1 text-lg font-semibold text-gray-900 hover:text-blue-600"
              data-testid="list-name"
            >
              {list.name || "買い物中"}
              <Pencil className="h-4 w-4 text-gray-400" />
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"
              aria-label="メニュー"
              data-testid="list-menu-button"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      setShowDeleteConfirm(true)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    data-testid="list-delete-menu"
                  >
                    <Trash2 className="h-4 w-4" />
                    リストを削除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* プログレスバー */}
      <div className="border-b border-gray-200 bg-white px-4 py-3" data-testid="progress-bar">
        <div className="mx-auto max-w-lg">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">進捗</span>
            <span className="font-semibold text-gray-900">
              {checkedItems.length}/{listItems?.length ?? 0}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
              data-testid="progress-fill"
            />
          </div>
        </div>
      </div>

      <PageContainer>
        <div className="space-y-6">
          {/* 未チェックのアイテム */}
          {uncheckedItems.length > 0 && (
            <section data-testid="unchecked-section">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-500">
                <ShoppingCart className="h-4 w-4" />
                買うもの
                <span className="text-xs text-gray-400">（左スワイプで外す）</span>
              </h2>
              <ul className="space-y-2" data-testid="unchecked-list">
                {uncheckedItems.map((item) => (
                  <li key={item.id} className="rounded-lg shadow-sm overflow-hidden">
                    <SwipeToRemove
                      onRemove={() => handleRemove(item.id)}
                      removeLabel="外す"
                    >
                      <div className="flex items-center gap-2 bg-white p-4">
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
                          {item.memo && (
                            <div className="ml-7 mt-1">
                              <MemoText
                                memo={item.memo}
                                className="text-sm text-gray-500"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </SwipeToRemove>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* チェック済みのアイテム */}
          {checkedItems.length > 0 && (
            <section data-testid="checked-section">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-500">
                <CheckCircle className="h-4 w-4" />
                カゴに入れた
              </h2>
              <ul className="space-y-2" data-testid="checked-list">
                {checkedItems.map((item) => (
                  <li key={item.id} className="rounded-lg overflow-hidden">
                    <SwipeToRemove
                      onRemove={() => handleRemove(item.id)}
                      removeLabel="外す"
                    >
                      <div className="flex items-center gap-2 bg-white/50 p-4">
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
                          {item.memo && (
                            <div className="ml-7 mt-1">
                              <MemoText
                                memo={item.memo}
                                className="text-sm text-gray-400 line-through"
                                checked
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </SwipeToRemove>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* アイテムがない場合 */}
          {(listItems?.length ?? 0) === 0 && (
            <div className="py-8 text-center">
              <p className="text-base text-gray-500">アイテムがありません</p>
              <p className="mt-2 text-sm text-gray-400">
                下の「+」ボタンから追加できます
              </p>
            </div>
          )}

          {/* 完了ボタン */}
          {allChecked && (listItems?.length ?? 0) > 0 && (
            <div
              className={cn(
                "rounded-xl bg-green-50 p-4 text-center",
                "border-2 border-green-200"
              )}
              data-testid="all-checked-message"
            >
              <CheckCircle className="mx-auto mb-2 h-12 w-12 text-green-600" />
              <p className="mb-4 font-semibold text-green-800">
                すべてカゴに入れました！
              </p>
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={handleComplete}
                disabled={isCompleting}
                data-testid="complete-button"
              >
                {isCompleting ? "処理中..." : "購入完了"}
              </Button>
            </div>
          )}

          {!allChecked && (listItems?.length ?? 0) > 0 && (
            <div className="pt-4">
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleComplete}
                disabled={isCompleting || checkedItems.length === 0}
                data-testid="partial-complete-button"
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
        data-testid="fab-add-item"
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
        <ItemSelector
          existingItems={items ?? []}
          tags={tags ?? []}
          groupId={listGroupId}
          onSubmit={handleAddItems}
          submitLabel="追加"
          submittingLabel="追加中..."
          showCancel
          onCancel={() => setIsAddSheetOpen(false)}
        />
      </BottomSheet>

      {/* リスト削除確認ダイアログ */}
      <BottomSheet
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="リストを削除"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            このリストを削除しますか？
          </p>

          {(listItems?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">
                リスト内のアイテム（{listItems?.length}件）の扱い
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 rounded-lg border-2 p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="itemHandling"
                    value="return"
                    checked={deleteItemHandling === "return"}
                    onChange={() => setDeleteItemHandling("return")}
                    className="h-4 w-4 text-blue-600"
                  />
                  <div>
                    <span className="font-medium text-gray-900">買いたいものに戻す</span>
                    <p className="text-xs text-gray-500">アイテムは削除されません</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 rounded-lg border-2 p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="itemHandling"
                    value="delete"
                    checked={deleteItemHandling === "delete"}
                    onChange={() => setDeleteItemHandling("delete")}
                    className="h-4 w-4 text-blue-600"
                  />
                  <div>
                    <span className="font-medium text-gray-900">完全に削除する</span>
                    <p className="text-xs text-gray-500">アイテムも削除されます</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setShowDeleteConfirm(false)}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteList}
              data-testid="list-delete-confirm"
            >
              削除する
            </Button>
          </div>
        </div>
      </BottomSheet>

      {/* 空リスト確認ダイアログ */}
      <BottomSheet
        isOpen={showEmptyListConfirm}
        onClose={() => setShowEmptyListConfirm(false)}
        title="リストが空になりました"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            すべてのアイテムを外しました。このリストを削除しますか？
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setShowEmptyListConfirm(false)}
            >
              リストを残す
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteEmptyList}
            >
              削除する
            </Button>
          </div>
        </div>
      </BottomSheet>
    </AppLayout>
  )
}
