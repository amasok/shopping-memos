"use client"

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { initializeDefaultTags } from "./tags"
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
