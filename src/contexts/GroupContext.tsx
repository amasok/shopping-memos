"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

const STORAGE_KEY = "selectedGroupId"

type GroupContextType = {
  selectedGroupId: string | undefined
  setSelectedGroupId: (groupId: string | undefined) => void
}

const GroupContext = createContext<GroupContextType | undefined>(undefined)

export function GroupProvider({ children }: { children: ReactNode }) {
  const [selectedGroupId, setSelectedGroupIdState] = useState<string | undefined>(undefined)
  const [isInitialized, setIsInitialized] = useState(false)

  // 初期化時にlocalStorageから読み込み
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      // "undefined" 文字列の場合はundefinedに変換
      setSelectedGroupIdState(stored === "undefined" ? undefined : stored)
    }
    setIsInitialized(true)
  }, [])

  // 変更時にlocalStorageに保存
  const setSelectedGroupId = (groupId: string | undefined) => {
    setSelectedGroupIdState(groupId)
    if (groupId === undefined) {
      localStorage.setItem(STORAGE_KEY, "undefined")
    } else {
      localStorage.setItem(STORAGE_KEY, groupId)
    }
  }

  // 初期化前はnullを返さない（childrenをレンダリング）
  // ただし、初期化前の値はundefinedのまま
  return (
    <GroupContext.Provider value={{ selectedGroupId: isInitialized ? selectedGroupId : undefined, setSelectedGroupId }}>
      {children}
    </GroupContext.Provider>
  )
}

export function useGroup() {
  const context = useContext(GroupContext)
  if (context === undefined) {
    throw new Error("useGroup must be used within a GroupProvider")
  }
  return context
}
