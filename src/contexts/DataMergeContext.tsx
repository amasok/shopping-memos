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
import {
  MERGE_COMPLETED_KEY,
  SELECTED_GROUP_KEY,
  applyMergeOutcome,
  clearLoginScopedState,
  discardPendingMerge,
  loadGuestDataForMerge,
  ensureGuestDataMigrated,
  hasGuestDataToMerge,
} from "@/lib/db/guestData"
import { trpc } from "@/infrastructure/trpc/client"
import { MERGE_LIMITS } from "@/shared/schemas/sync"
import { REQUEST_LIMITS, TEXT_LIMITS, clampQuantity, clipText } from "@/shared/schemas/limits"
import { hasMergeData, splitMergeData } from "@/lib/merge/splitMergeData"
import { applyTagIdMappings } from "@/lib/merge/applyTagIdMappings"
import { buildMergeOutcome, collectFailedIds, emptyFailedIds } from "@/lib/merge/mergeOutcome"

const clipNullable = (value: string | null | undefined, max: number) =>
  value == null ? null : clipText(value, max)

/**
 * Dexie の日付を ISO 文字列にする。アプリは Date で保存するが、古いデータや別の経路で文字列が入っていても、
 * merge 全体を例外で止めない。不正な値はそのまま送り、サーバーの検証でその 1 件だけがスキップされる（#86）
 */
function toIso(value: unknown): string {
  if (!(value instanceof Date)) return value as string
  // 中身が不正な Date（new Date("x")）は toISOString() が RangeError を投げる。null にすると、null を許す項目
  // （purchasedAt など）で意味が黙って変わるので、"Invalid Date" として送り、サーバーの検証でその 1 件だけをスキップさせる
  return Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
}
function toIsoNullable(value: unknown): string | null {
  return value == null ? null : toIso(value)
}

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
  /** 取り込めなかったデータを破棄する（このアカウントの分を、ゲストの DB から消す） */
  discardSkipped: () => Promise<void>
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
      // 次にログインしたときに、ゲストのデータがあればもう一度 merge する。
      // 以前の印は移行の判定に使うので、移行が終わってから消す
      // 移行に失敗したら印を残す（次の読み込みで移行をやり直す）
      if (!isAuthLoading) {
        void ensureGuestDataMigrated().then((migrated) => {
          if (migrated) clearLoginScopedState()
        })
      }
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

  // 「破棄する」: このアカウントで取り込めずに残したデータを消す（何度送っても取り込めないものを、利用者が消せるように。#144）
  const discardSkipped = useCallback(async () => {
    if (!user) return
    await discardPendingMerge(user.id)
    localStorage.removeItem(`${MERGE_SKIPPED_KEY}-${user.id}`)
    setSkippedCount(0)
  }, [user])

  const executeMerge = useCallback(async () => {
    if (!user) return

    // 以前の仕組みの印がある端末では、ゲストのデータを送らずに空にする（一度だけ）。
    // 移行に失敗した読み込みでは merge しない（古いゲストのデータを送らない）。サーバーのデータを表示し、
    // 次の読み込みで移行からやり直す
    if (!(await ensureGuestDataMigrated())) {
      setIsMergeCompleted(true)
      return
    }

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
      // 送るゲストのデータ: 通常のテーブルと、このアカウントで前回取り込めずに残したもの（pendingMerge）。
      // ほかのアカウントの分は送らない（#144）
      const guest = await loadGuestDataForMerge(user.id)
      const { items: localItems, tags: localTags, lists: localLists, listItems: localListItems } = guest

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
          purchasedAt: toIsoNullable(item.purchasedAt),
          createdAt: toIso(item.createdAt),
        })),
        tags: localTags.map((tag) => ({
          id: tag.id,
          name: clipText(tag.name, TEXT_LIMITS.tagName),
          createdAt: toIso(tag.createdAt),
        })),
        lists: localLists.map((list) => ({
          id: list.id,
          name: clipText(list.name, TEXT_LIMITS.listName),
          status: list.status,
          createdAt: toIso(list.createdAt),
          completedAt: toIsoNullable(list.completedAt),
          purchasedAt: toIsoNullable(list.purchasedAt),
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
          createdAt: toIso(listItem.createdAt),
        })),
        // 履歴はlistsのpurchasedAtが設定されているもの（listId = list.id）
        history: localHistory.map((list) => ({
          id: list.id,
          listId: list.id,
          location: clipNullable(list.location, TEXT_LIMITS.location),
          purchasedAt: toIso(list.purchasedAt),
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
      // 取り込めなかったレコードの ID（ゲストの DB に残すもの。#144）
      const failed = emptyFailedIds()
      // サーバーが付け替えたタグの ID（ほかのユーザーのタグと ID が重なった場合）。後から送る分に反映する
      const tagIdMap = new Map<string, string>()
      for (const [index, chunk] of chunks.entries()) {
        const result = await mergeMutation.mutateAsync({ data: applyTagIdMappings(chunk, tagIdMap) })
        for (const mapping of result.idMappings ?? []) {
          if (mapping.entity === "tag") tagIdMap.set(mapping.localId, mapping.serverId)
        }
        // 検証でスキップした件数と、レコード単位で取り込めなかった件数だけを数える
        skipped += result.mergeResult.notImportedCount
        // notImported の位置は、このチャンクの配列での位置（付け替える前のチャンクと突き合わせる）
        collectFailedIds(chunk, result.mergeResult, failed)
        console.log(`Data merge ${index + 1}/${chunks.length} completed:`, result.mergeResult)
      }

      // 最後の分まで成功してから、このログインの間は merge 済みにする（ゲストに戻ったら消える）
      localStorage.setItem(mergeKey, "true")

      // 取り込めた分と取り込み済みの分はゲストの DB から消し、取り込めなかったものだけを、このアカウントの分として
      // pendingMerge に移す（ゲストの画面には出さず、このアカウントの次の merge でだけ送り直す。#144）
      await applyMergeOutcome(user.id, buildMergeOutcome(guest, failed))

      if (skipped > 0) {
        // 取り込めなかったデータがあれば、リロード後に件数を通知する（「破棄する」で消せる）
        localStorage.setItem(`${MERGE_SKIPPED_KEY}-${user.id}`, String(skipped))
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
        discardSkipped,
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
