"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { useDataMerge } from "@/contexts/DataMergeContext"
import { trpc } from "@/infrastructure/trpc/client"
import { SyncEngine, type SyncEngineState, type SyncTransport } from "@/infrastructure/sync/SyncEngine"
import { getUserDb } from "@/lib/db/userDb"
import { isLocalFirstEnabled } from "@/lib/featureFlags"

/**
 * 同期の状態とエンジンを提供する（offline-support.md「SyncProvider」。#62 O6）
 *
 * ログイン中で、ゲストのデータの merge が終わったら、ユーザーの DB の同期エンジンを動かす。
 * NEXT_PUBLIC_LOCAL_FIRST が false なら drain モード（未送信のキューを送り切るだけ。pull はしない）。
 * 同期のきっかけ: 起動、online、前面に戻ったとき（前回から 30 秒以上空いたら）、手動、書き込みの後（requestSync）
 */

/** 前面に戻ったときに同期する、前回の同期からの間隔 */
export const RESUME_SYNC_INTERVAL_MS = 30_000

export interface SyncContextValue extends SyncEngineState {
  /** ログイン中の同期エンジン（ゲスト・merge の前は null） */
  engine: SyncEngine | null
  /** 手動で同期する（push → pull） */
  sync: () => Promise<void>
  /** ローカルへの書き込みの後に呼ぶ（2 秒のデバウンスで同期） */
  requestSync: () => void
}

const IDLE_STATE: SyncEngineState = {
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  sessionExpired: false,
  clientTooOld: false,
}

const noopSubscribe = () => () => {}
const idleSnapshot = () => IDLE_STATE

const SyncContext = createContext<SyncContextValue | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { isMergeCompleted } = useDataMerge()
  const utils = trpc.useUtils()
  const userId = user?.id ?? null

  // エンジンの作成は副作用がない（DB を開くのも通信も start / sync から）。動かすのは effect で行う
  const engine = useMemo(() => {
    if (!userId || !isMergeCompleted) return null
    const transport: SyncTransport = {
      push: (input) => utils.client.sync.push.mutate(input),
      pull: (input) => utils.client.sync.pull.query(input),
    }
    return new SyncEngine({
      db: getUserDb(userId),
      transport,
      mode: isLocalFirstEnabled() ? "full" : "drain",
      lockName: `shopping-memos-sync-${userId}`,
    })
  }, [userId, isMergeCompleted, utils.client])

  useEffect(() => {
    if (!engine) return
    const instance = engine
    instance
      .start()
      .then(() => instance.sync())
      .catch((error) => console.error("Sync start failed:", error))

    const handleOnline = () => {
      instance.setOnline(true)
      void instance.sync()
    }
    const handleOffline = () => instance.setOnline(false)
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return
      const last = instance.getState().lastSyncAt
      if (!last || Date.now() - last.getTime() >= RESUME_SYNC_INTERVAL_MS) void instance.sync()
    }
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      document.removeEventListener("visibilitychange", handleVisibility)
      instance.stop()
    }
  }, [engine])

  const state = useSyncExternalStore(
    engine?.subscribe ?? noopSubscribe,
    engine?.getState ?? idleSnapshot,
    idleSnapshot
  )
  const sync = useCallback(async () => {
    await engine?.sync()
  }, [engine])
  const requestSync = useCallback(() => engine?.requestSync(), [engine])

  return <SyncContext.Provider value={{ ...state, engine, sync, requestSync }}>{children}</SyncContext.Provider>
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext)
  if (!context) throw new Error("useSync must be used within a SyncProvider")
  return context
}
