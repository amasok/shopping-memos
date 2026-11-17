"use client"

import { useCallback, useMemo } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"
import { useDataMerge } from "@/contexts/DataMergeContext"
import { useSync } from "@/contexts/SyncContext"
import { trpc } from "@/infrastructure/trpc/client"
import { createClock } from "@/infrastructure/local/clock"
import type { LocalStore } from "@/infrastructure/local/repository"
import { db as guestDb } from "@/lib/db"
import { getUserDb } from "@/lib/db/userDb"
import { isLocalFirstEnabled } from "@/lib/featureFlags"

/**
 * カタログの読み書きの経路（#62 O7。openspec の catalog「モードによる読み書きの経路」、design.md D1）
 *
 * - guest: ログインしていない、またはログイン中で merge が終わる前。ゲスト DB（キューに積まない）
 * - server: ログイン中・merge 済み・フラグ false。tRPC（今のまま）
 * - local: ログイン中・merge 済み・フラグ true。ユーザー DB（キューに積み、書き込みの後に同期を予約する）
 */
export type CatalogMode = "guest" | "server" | "local"

export function resolveCatalogMode(state: { isLoggedIn: boolean; isMergeCompleted: boolean; localFirst: boolean }): CatalogMode {
  if (!state.isLoggedIn || !state.isMergeCompleted) return "guest"
  return state.localFirst ? "local" : "server"
}

/** ゲストの時計は補正なしの端末の時計（サーバーと同期しない） */
const guestClock = createClock(0)
const guestStore: LocalStore = { db: guestDb, clock: guestClock, queue: false }

export interface CatalogSource {
  mode: CatalogMode
  /** 端末の DB に読み書きするときの store（server では null。local で同期エンジンがまだないときも null） */
  store: LocalStore | null
  /** local で、ユーザー DB の初回の同期が一度も終わっていない（一覧は読み込み中にする） */
  awaitingFirstSync: boolean
  /** 選んでいるグループ */
  selectedGroupId: string | undefined
  isAuthLoading: boolean
  /** 端末の DB に書いた後に呼ぶ（local なら 2 秒のデバウンスで同期を予約する） */
  afterWrite: () => void
  /**
   * 買い物の変更の後に、「買いたいもの」の一覧を追いつかせる（catalog「サーバーファーストの買い物の変更の後のカタログ」）
   * server: catalog.getItems のキャッシュを無効にする / guest・local: 何もしない（同じ端末の DB を一覧がそのまま追う。#62 O8）
   */
  refreshCatalog: () => void
}

export function useCatalogSource(): CatalogSource {
  const { user, isLoading: isAuthLoading } = useAuth()
  const { selectedGroupId } = useGroup()
  const { isMergeCompleted } = useDataMerge()
  const { engine, requestSync, lastSyncAt } = useSync()
  const utils = trpc.useUtils()

  const mode = resolveCatalogMode({ isLoggedIn: !!user, isMergeCompleted, localFirst: isLocalFirstEnabled() })
  const userId = user?.id

  const store = useMemo<LocalStore | null>(() => {
    if (mode === "guest") return guestStore
    if (mode === "local" && engine && userId) return { db: getUserDb(userId), clock: engine.getClock(), queue: true }
    return null
  }, [mode, engine, userId])

  const afterWrite = useCallback(() => {
    if (mode === "local") requestSync()
  }, [mode, requestSync])

  const refreshCatalog = useCallback(() => {
    if (mode === "server") void utils.catalog.getItems.invalidate()
  }, [mode, utils])

  return {
    mode,
    store,
    awaitingFirstSync: mode === "local" && lastSyncAt === null,
    selectedGroupId,
    isAuthLoading,
    afterWrite,
    refreshCatalog,
  }
}

/** local で同期エンジンがまだないときの書き込みのエラー（design.md D1） */
export function requireStore(source: CatalogSource): LocalStore {
  if (!source.store) throw new Error("準備中です。少し待ってからもう一度お試しください")
  return source.store
}
