"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

const STORAGE_KEY = "selectedGroupId"

type GroupContextType = {
  selectedGroupId: string | undefined
  setSelectedGroupId: (groupId: string | undefined) => void
}

const GroupContext = createContext<GroupContextType | undefined>(undefined)

export function GroupProvider({ children }: { children: ReactNode }) {
  // 初期化時にlocalStorageから読み込み（lazy initialization）
  const [selectedGroupId, setSelectedGroupIdState] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return stored === "undefined" ? undefined : stored
    }
    return undefined
  })

  // 変更時にlocalStorageに保存
  const setSelectedGroupId = (groupId: string | undefined) => {
    setSelectedGroupIdState(groupId)
    if (groupId === undefined) {
      localStorage.setItem(STORAGE_KEY, "undefined")
    } else {
      localStorage.setItem(STORAGE_KEY, groupId)
    }
  }

  return (
    <GroupContext.Provider value={{ selectedGroupId, setSelectedGroupId }}>
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
