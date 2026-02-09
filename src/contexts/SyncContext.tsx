"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { syncEngine } from "@/infrastructure/sync/SyncEngine"

/**
 * 同期状態
 */
interface SyncState {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  lastSyncAt: Date | null
  error: Error | null
}

/**
 * 同期コンテキストの値
 */
interface SyncContextValue extends SyncState {
  /** 手動で同期を実行 */
  sync: () => Promise<void>
  /** サーバーから変更をプル */
  pull: () => Promise<void>
  /** 初回ログイン時のマージ */
  mergeLocalData: () => Promise<void>
}

const SyncContext = createContext<SyncContextValue | null>(null)

interface SyncProviderProps {
  children: ReactNode
}

/**
 * 同期コンテキストプロバイダー
 * 同期状態と操作を提供
 */
export function SyncProvider({ children }: SyncProviderProps) {
  const [state, setState] = useState<SyncState>({
    isOnline: syncEngine.getIsOnline(),
    isSyncing: syncEngine.getIsSyncing(),
    pendingCount: 0,
    lastSyncAt: null,
    error: null,
  })

  // 初期化とリスナー登録
  useEffect(() => {
    // 初期状態を取得
    const initializeState = async () => {
      const pendingCount = await syncEngine.getPendingCount()
      const lastSyncAtStr = localStorage.getItem("lastSyncAt")

      setState((prev) => ({
        ...prev,
        isOnline: syncEngine.getIsOnline(),
        isSyncing: syncEngine.getIsSyncing(),
        pendingCount,
        lastSyncAt: lastSyncAtStr ? new Date(lastSyncAtStr) : null,
      }))
    }

    initializeState()

    // SyncEngineの状態変更を監視
    const unsubscribe = syncEngine.subscribe(() => {
      syncEngine.getPendingCount().then((pendingCount) => {
        setState((prev) => ({
          ...prev,
          isOnline: syncEngine.getIsOnline(),
          isSyncing: syncEngine.getIsSyncing(),
          pendingCount,
        }))
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // 手動同期
  const sync = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null }))

      // TODO: tRPCクライアントを使用してpushFnを提供
      // 現在はSyncEngineがtRPCクライアントを受け取る設計になっているため
      // ここではエラーなく呼び出せるようにする
      await syncEngine.syncPendingOperations()

      const lastSyncAtStr = localStorage.getItem("lastSyncAt")
      setState((prev) => ({
        ...prev,
        lastSyncAt: lastSyncAtStr ? new Date(lastSyncAtStr) : null,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error : new Error("同期に失敗しました"),
      }))
    }
  }, [])

  // プル
  const pull = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null }))

      // TODO: tRPCクライアントを使用してpullFnを提供
      // await syncEngine.pullChanges(...)

      const lastSyncAtStr = localStorage.getItem("lastSyncAt")
      setState((prev) => ({
        ...prev,
        lastSyncAt: lastSyncAtStr ? new Date(lastSyncAtStr) : null,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error : new Error("プルに失敗しました"),
      }))
    }
  }, [])

  // 初回ログイン時のマージ
  const mergeLocalData = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null }))

      // TODO: tRPCクライアントを使用してmergeFnを提供
      // await syncEngine.mergeLocalData(...)

      const lastSyncAtStr = localStorage.getItem("lastSyncAt")
      setState((prev) => ({
        ...prev,
        lastSyncAt: lastSyncAtStr ? new Date(lastSyncAtStr) : null,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error : new Error("マージに失敗しました"),
      }))
    }
  }, [])

  const value: SyncContextValue = {
    ...state,
    sync,
    pull,
    mergeLocalData,
  }

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

/**
 * 同期コンテキストを使用するフック
 */
export function useSync(): SyncContextValue {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error("useSync must be used within a SyncProvider")
  }
  return context
}
