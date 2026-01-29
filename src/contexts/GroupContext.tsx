"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { useAuth } from "./AuthContext"
import { trpc } from "@/infrastructure/trpc/client"

const STORAGE_KEY = "selectedGroupId"

// 開発環境でのログ出力
const isDev = process.env.NODE_ENV !== "production"

type GroupContextType = {
  selectedGroupId: string | undefined
  setSelectedGroupId: (groupId: string | undefined) => void
  /** グループIDが有効かどうかを確認中 */
  isValidating: boolean
}

const GroupContext = createContext<GroupContextType | undefined>(undefined)

export function GroupProvider({ children }: { children: ReactNode }) {
  // 初期化時にlocalStorageから読み込み（lazy initialization）
  const [selectedGroupId, setSelectedGroupIdState] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isDev) {
      console.log("[GroupContext] localStorage value:", stored)
    }
    if (stored) {
      const value = stored === "undefined" ? undefined : stored
      if (isDev) {
        console.log("[GroupContext] Initial selectedGroupId:", value)
      }
      return value
    }
    return undefined
  })

  // ログイン状態を取得
  const { user, isLoading: isAuthLoading } = useAuth()

  // グループ一覧を取得（ログイン中のみ）
  const groupsQuery = trpc.identity.getGroups.useQuery(undefined, {
    enabled: !!user && !isAuthLoading,
  })

  // 変更時にlocalStorageに保存
  const setSelectedGroupId = useCallback((groupId: string | undefined) => {
    if (isDev) {
      console.log("[GroupContext] setSelectedGroupId called:", groupId)
    }
    setSelectedGroupIdState(groupId)
    if (groupId === undefined) {
      localStorage.setItem(STORAGE_KEY, "undefined")
    } else {
      localStorage.setItem(STORAGE_KEY, groupId)
    }
  }, [])

  // グループの有効性を確認（レンダリング中に同期的にチェック）
  // 選択中のグループIDが、ユーザーが所属するグループに含まれているか確認
  // 含まれていなければundefinedにリセット（グループから除外された場合など）
  const shouldResetGroupId =
    user &&
    !isAuthLoading &&
    !groupsQuery.isLoading &&
    selectedGroupId &&
    groupsQuery.data &&
    !groupsQuery.data.some((g) => g.id === selectedGroupId)

  if (shouldResetGroupId) {
    console.log(
      "[GroupContext] Selected group is no longer accessible, resetting to personal mode:",
      selectedGroupId
    )
    setSelectedGroupId(undefined)
  }

  // デバッグ: selectedGroupId の変化を追跡
  useEffect(() => {
    if (isDev) {
      console.log("[GroupContext] selectedGroupId changed:", selectedGroupId)
    }
  }, [selectedGroupId])

  // バリデーション中かどうか
  const isValidating = !!user && !isAuthLoading && groupsQuery.isLoading && !!selectedGroupId

  return (
    <GroupContext.Provider value={{ selectedGroupId, setSelectedGroupId, isValidating }}>
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
