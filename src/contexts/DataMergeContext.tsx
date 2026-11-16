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
import {
  MERGE_COMPLETED_KEY,
  SELECTED_GROUP_KEY,
  clearGuestData,
  clearLoginScopedState,
  hasGuestDataToMerge,
} from "@/lib/db/guestData"
import { trpc } from "@/infrastructure/trpc/client"
import { MERGE_LIMITS } from "@/shared/schemas/sync"
import { REQUEST_LIMITS, TEXT_LIMITS, clampQuantity, clipText } from "@/shared/schemas/limits"
import { hasMergeData, splitMergeData } from "@/lib/merge/splitMergeData"
import { applyTagIdMappings } from "@/lib/merge/applyTagIdMappings"

const clipNullable = (value: string | null | undefined, max: number) =>
  value == null ? null : clipText(value, max)

/** 取り込めなかった件数（リロードをまたいで表示するため localStorage に保存する） */
const MERGE_SKIPPED_KEY = "data-merge-skipped"
/**
 * 1 回の sync.merge のボディの目安。サーバーの上限（sync.merge 単独で 4MB）より少し小さくして、
 * 見積もりの誤差があっても 413 にならないようにする（#116）
 */
const MERGE_CHUNK_MAX_BYTES = Math.floor(REQUEST_LIMITS.mergeBodyBytes * 0.875)

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
  /** 取り込めなかった件数（0 なら通知しない） */
  skippedCount: number
  /** 取り込めなかった件数の通知を閉じる */
  dismissSkipped: () => void
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
  const [skippedCount, setSkippedCount] = useState(0)
  const mergeAttempted = useRef(false)
  /** 実行中の merge があるか（分割送信を 2 本同時に走らせない。#116） */
  const mergeInFlight = useRef(false)

  const mergeMutation = trpc.sync.merge.useMutation()

  // 初期化時にlocalStorageからマージ完了状態を読み込む
  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ユーザーログアウト時にリセットが必要
      setIsMergeCompleted(false)
      // ゲストに戻った（ログアウト・セッション切れ）ら、ログイン中だけの状態を消す。
      // 次にログインしたときに、ゲストのデータがあればもう一度 merge する
      if (!isAuthLoading) clearLoginScopedState()
      return
    }

    const mergeKey = `${MERGE_COMPLETED_KEY}-${user.id}`
    const completed = localStorage.getItem(mergeKey) === "true"
    if (completed) {
      setIsMergeCompleted(true)
    }
    // マージ後のリロードをまたいで、取り込めなかった件数を通知する
    const skipped = Number(localStorage.getItem(`${MERGE_SKIPPED_KEY}-${user.id}`) ?? 0)
    setSkippedCount(Number.isFinite(skipped) && skipped > 0 ? skipped : 0)
  }, [user, isAuthLoading])

  const dismissSkipped = useCallback(() => {
    if (user) localStorage.removeItem(`${MERGE_SKIPPED_KEY}-${user.id}`)
    setSkippedCount(0)
  }, [user])

  const executeMerge = useCallback(async () => {
    if (!user) return

    const mergeKey = `${MERGE_COMPLETED_KEY}-${user.id}`
    const alreadyMerged = localStorage.getItem(mergeKey) === "true"
    if (alreadyMerged) {
      setIsMergeCompleted(true)
      return
    }
    if (mergeInFlight.current) return
    mergeInFlight.current = true

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

      // 送るデータがなければマージ不要（初期タグだけのゲストも送らない）
      if (
        !hasGuestDataToMerge({
          tags: localTags,
          items: localItems,
          lists: localLists,
          listItems: localListItems,
        })
      ) {
        localStorage.setItem(mergeKey, "true")
        setIsMerging(false)
        setIsMergeCompleted(true)
        setMergedCounts({ items: 0, tags: 0, lists: 0, listItems: 0, history: 0 })
        return
      }

      const payload = {
        items: localItems.map((item) => ({
          id: item.id,
          name: clipText(item.name, TEXT_LIMITS.itemName),
          quantity: clampQuantity(item.quantity),
          memo: clipNullable(item.memo, TEXT_LIMITS.memo),
          tagIds: item.tagIds.slice(0, MERGE_LIMITS.tagIdsPerEntity),
          purchasedAt: item.purchasedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        })),
        tags: localTags.map((tag) => ({
          id: tag.id,
          name: clipText(tag.name, TEXT_LIMITS.tagName),
          createdAt: tag.createdAt.toISOString(),
        })),
        lists: localLists.map((list) => ({
          id: list.id,
          name: clipText(list.name, TEXT_LIMITS.listName),
          status: list.status,
          createdAt: list.createdAt.toISOString(),
          completedAt: list.completedAt?.toISOString() ?? null,
          purchasedAt: list.purchasedAt?.toISOString() ?? null,
          location: clipNullable(list.location, TEXT_LIMITS.location),
        })),
        listItems: localListItems.map((listItem) => ({
          id: listItem.id,
          listId: listItem.listId,
          name: clipText(listItem.name, TEXT_LIMITS.listItemName),
          quantity: clampQuantity(listItem.quantity),
          memo: clipNullable(listItem.memo, TEXT_LIMITS.memo),
          tagIds: listItem.tagIds.slice(0, MERGE_LIMITS.tagIdsPerEntity),
          checked: listItem.checked,
          createdAt: listItem.createdAt.toISOString(),
        })),
        // 履歴はlistsのpurchasedAtが設定されているもの（listId = list.id）
        history: localHistory.map((list) => ({
          id: list.id,
          listId: list.id,
          location: clipNullable(list.location, TEXT_LIMITS.location),
          purchasedAt: list.purchasedAt!.toISOString(),
        })),
      }

      // 件数とボディの上限に収まるように分け、参照される側（タグ → … → 履歴）から順に送る（#116）。
      // 途中で失敗したら、完了の印を付けずにエラーにする。再試行では最初から送り直すが、
      // サーバーは取り込み済みのレコードを失敗に数えないので、件数が重複しない
      const chunks = hasMergeData(payload)
        ? splitMergeData(payload, {
            limits: MERGE_LIMITS,
            maxBytes: MERGE_CHUNK_MAX_BYTES,
          })
        : []
      let skipped = 0
      // サーバーが付け替えたタグの ID（ほかのユーザーのタグと ID が重なった場合）。後から送る分に反映する
      const tagIdMap = new Map<string, string>()
      for (const [index, chunk] of chunks.entries()) {
        const result = await mergeMutation.mutateAsync({ data: applyTagIdMappings(chunk, tagIdMap) })
        for (const mapping of result.idMappings ?? []) {
          if (mapping.entity === "tag") tagIdMap.set(mapping.localId, mapping.serverId)
        }
        // 検証でスキップした件数と、レコード単位で取り込めなかった件数だけを数える
        skipped += result.mergeResult.notImportedCount
        console.log(`Data merge ${index + 1}/${chunks.length} completed:`, result.mergeResult)
      }

      // 最後の分まで成功してから、このログインの間は merge 済みにする（ゲストに戻ったら消える）
      localStorage.setItem(mergeKey, "true")

      if (skipped > 0) {
        // 取り込めなかったデータがあれば、リロード後に件数を通知する。
        // ゲストのデータは全部残し、次のログインで送り直す（取り込み済みの分は「取り込み済み」になるだけ）
        localStorage.setItem(`${MERGE_SKIPPED_KEY}-${user.id}`, String(skipped))
      } else {
        // 全部取り込めたら、ゲストのデータを空にする（ログアウトしても、ログイン前のデータが見えないように）
        await clearGuestData()
      }

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
    } finally {
      mergeInFlight.current = false
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
      // 自動実行の effect にもう一度走らせない（ここで 1 回だけ実行する）
      mergeAttempted.current = true
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
        skippedCount,
        dismissSkipped,
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
