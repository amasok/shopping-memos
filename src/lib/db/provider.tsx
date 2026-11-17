"use client"

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { initializeDefaultTags } from "./tags"
import { ensureGuestDataMigrated } from "./guestData"
import { isDbBlocked, subscribeDbBlocked } from "./versionEvents"

interface DBContextValue {
  isReady: boolean
}

const DBContext = createContext<DBContextValue>({ isReady: false })

export function useDB() {
  return useContext(DBContext)
}

/** 新しいバージョンの DB を開くのを、古いタブが止めている間の案内（#62 O6） */
export function DbBlockedNotice() {
  const blocked = useSyncExternalStore(subscribeDbBlocked, isDbBlocked, () => false)
  if (!blocked) return null
  return (
    <div
      role="alert"
      data-testid="db-blocked-notice"
      className="fixed inset-x-0 top-0 z-50 bg-amber-100 px-4 py-3 text-center text-sm text-amber-900"
    >
      アプリを更新しています。このアプリを開いているほかのタブを閉じてください。
    </div>
  )
}

export function DBProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    async function init() {
      try {
        // ゲストのデータの移行（以前の仕組みの端末では全テーブルを空にする）が終わってから準備完了にする（#183）。
        // Dexie の liveQuery は最初の読み込みの途中の書き込みを拾わないので、一覧の最初の読み込みが移行と重なると、
        // 空にした後も古いデータが画面に残る。一覧の hooks（useCatalogSource）は isReady まで読まない。
        // 移行に失敗しても続ける（移行は次の読み込みでやり直す）
        await ensureGuestDataMigrated()
        await initializeDefaultTags()
        setIsReady(true)
      } catch (error) {
        console.error("Failed to initialize database:", error)
        setIsReady(true) // エラーでも続行
      }
    }
    init()
  }, [])

  return (
    <DBContext.Provider value={{ isReady }}>
      <DbBlockedNotice />
      {children}
    </DBContext.Provider>
  )
}
