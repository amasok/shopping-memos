"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react"
import { useAuth } from "@/contexts/AuthContext"
import { db } from "@/lib/db"
import { trpc } from "@/infrastructure/trpc/client"

const MERGE_COMPLETED_KEY = "data-merge-completed"
const SELECTED_GROUP_KEY = "selectedGroupId"

interface MergedCounts {
  items: number
  tags: number
  lists: number
  listItems: number
  history: number
}

interface DataMergeContextValue {
  /** マージ処理中か */
  isMerging: boolean
  /** マージが完了したか */
  isMergeCompleted: boolean
  /** エラーメッセージ */
  error: string | null
  /** マージされたデータの件数 */
  mergedCounts: MergedCounts | null
  /** マージをリトライする */
  retryMerge: () => void
}

const DataMergeContext = createContext<DataMergeContextValue | null>(null)

/**
 * データマージコンテキストプロバイダー
 * ログイン時にローカルデータをサーバーにマージする
 */
export function DataMergeProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [isMerging, setIsMerging] = useState(false)
  const [isMergeCompleted, setIsMergeCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergedCounts, setMergedCounts] = useState<MergedCounts | null>(null)
  const mergeAttempted = useRef(false)

  const mergeMutation = trpc.sync.merge.useMutation()

  // 初期化時にlocalStorageからマージ完了状態を読み込む
  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ユーザーログアウト時にリセットが必要
      setIsMergeCompleted(false)
      return
    }

    const mergeKey = `${MERGE_COMPLETED_KEY}-${user.id}`
    const completed = localStorage.getItem(mergeKey) === "true"
    if (completed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageから初期状態を読み込む
      setIsMergeCompleted(true)
    }
  }, [user])

  const executeMerge = useCallback(async () => {
    if (!user) return

    const mergeKey = `${MERGE_COMPLETED_KEY}-${user.id}`
    const alreadyMerged = localStorage.getItem(mergeKey) === "true"
    if (alreadyMerged) {
      setIsMergeCompleted(true)
      return
    }

    setIsMerging(true)
    setError(null)

    try {
      // IndexedDB からすべてのデータを取得
      const [localItems, localTags, localLists, localListItems] =
        await Promise.all([
          db.items.toArray(),
          db.tags.toArray(),
          db.lists.toArray(),
          db.listItems.toArray(),
        ])

      // 履歴はlistsのpurchasedAtが設定されているもの
      const localHistory = localLists.filter((list) => !!list.purchasedAt)

      // ローカルにデータがなければマージ不要
      if (
        localItems.length === 0 &&
        localTags.length === 0 &&
        localLists.length === 0 &&
        localListItems.length === 0
      ) {
        localStorage.setItem(mergeKey, "true")
        setIsMerging(false)
        setIsMergeCompleted(true)
        setMergedCounts({ items: 0, tags: 0, lists: 0, listItems: 0, history: 0 })
        return
      }

      // サーバーにマージ
      const result = await mergeMutation.mutateAsync({
        data: {
          items: localItems.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            memo: item.memo ?? null,
            tagIds: item.tagIds,
            purchasedAt: item.purchasedAt?.toISOString() ?? null,
            createdAt: item.createdAt.toISOString(),
          })),
          tags: localTags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            createdAt: tag.createdAt.toISOString(),
          })),
          lists: localLists.map((list) => ({
            id: list.id,
            name: list.name,
            status: list.status,
            createdAt: list.createdAt.toISOString(),
            completedAt: list.completedAt?.toISOString() ?? null,
            purchasedAt: list.purchasedAt?.toISOString() ?? null,
            location: list.location ?? null,
          })),
          listItems: localListItems.map((listItem) => ({
            id: listItem.id,
            listId: listItem.listId,
            name: listItem.name,
            quantity: listItem.quantity,
            memo: listItem.memo ?? null,
            tagIds: listItem.tagIds,
            checked: listItem.checked,
            createdAt: listItem.createdAt.toISOString(),
          })),
          // 履歴はlistsのpurchasedAtが設定されているもの（listId = list.id）
          history: localHistory.map((list) => ({
            id: list.id,
            listId: list.id,
            location: list.location ?? null,
            purchasedAt: list.purchasedAt!.toISOString(),
          })),
        },
      })

      // マージ完了をマーク
      localStorage.setItem(mergeKey, "true")

      console.log("Data merge completed:", result.mergeResult)

      // マージされたアイテムが個人アイテム（groupId = undefined）を含む場合、
      // selectedGroupId を undefined にリセットして個人モードに切り替える
      // これにより、マージ後に個人アイテムが表示される
      const hasPersonalItems = localItems.some((item) => !item.groupId)
      if (hasPersonalItems) {
        console.log("[DataMerge] Personal items found, switching to personal mode")
        localStorage.setItem(SELECTED_GROUP_KEY, "undefined")
      }

      // マージ完了後にページをリロードしてサーバーデータを反映
      // これにより、すべてのコンポーネントがサーバーモードで再初期化される
      window.location.reload()
    } catch (err) {
      console.error("Data merge failed:", err)
      setIsMerging(false)
      setError(err instanceof Error ? err.message : "マージに失敗しました")
    }
  }, [user, mergeMutation])

  // ログイン後に自動でマージを実行
  useEffect(() => {
    if (isAuthLoading || !user || mergeAttempted.current) return

    mergeAttempted.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ログイン時に一度だけマージを実行する必要がある
    executeMerge()
  }, [isAuthLoading, user, executeMerge])

  const retryMerge = useCallback(() => {
    if (user) {
      const mergeKey = `${MERGE_COMPLETED_KEY}-${user.id}`
      localStorage.removeItem(mergeKey)
      mergeAttempted.current = false
      setIsMergeCompleted(false)
      executeMerge()
    }
  }, [user, executeMerge])

  return (
    <DataMergeContext.Provider
      value={{
        isMerging,
        isMergeCompleted,
        error,
        mergedCounts,
        retryMerge,
      }}
    >
      {children}
    </DataMergeContext.Provider>
  )
}

/**
 * データマージコンテキストを使用するフック
 */
export function useDataMerge(): DataMergeContextValue {
  const context = useContext(DataMergeContext)
  if (!context) {
    throw new Error("useDataMerge must be used within a DataMergeProvider")
  }
  return context
}
