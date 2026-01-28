"use client"

import { createContext, useCallback, useContext, useState } from "react"

export interface User {
  id: string
  name: string
  email: string
  avatarUrl?: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: () => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEY = "shopping-memos-auth"

// モックユーザー
const mockUser: User = {
  id: "user-1",
  name: "田中太郎",
  email: "tanaka@example.com",
  avatarUrl: undefined,
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // 初期化時にlocalStorageから復元（lazy initialization）
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === "undefined") return null
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
    }
    return null
  })
  // クライアントサイドでは初期状態でfalse（lazy initializationで処理済み）
  const [isLoading, setIsLoading] = useState(false)

  const login = useCallback(async () => {
    // モック: 実際はGoogle OAuthを実行
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 500)) // 擬似的な遅延
    setUser(mockUser)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockUser))
    setIsLoading(false)
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
