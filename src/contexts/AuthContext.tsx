"use client"

import { createContext, useCallback, useContext } from "react"
import { SessionProvider, useSession, signIn, signOut } from "next-auth/react"
import { clearLoginScopedState, ensureGuestDataMigrated } from "@/lib/db/guestData"

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
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()

  const user: User | null = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? "",
        email: session.user.email ?? "",
        avatarUrl: session.user.image ?? undefined,
      }
    : null

  const isLoading = status === "loading"

  const login = useCallback(async () => {
    await signIn("google", { callbackUrl: "/" })
  }, [])

  const logout = useCallback(async () => {
    // ログイン中だけの状態（merge 済みの印・選んでいたグループ）を消してからログアウトする。
    // ゲストのデータは merge が全部成功したときに空になっているので、ログアウト後は空のゲストになる
    // 以前の印は移行の判定に使うので、移行が終わってから消す（失敗したら残し、次の読み込みでやり直す）
    if (await ensureGuestDataMigrated()) clearLoginScopedState()
    await signOut({ callbackUrl: "/" })
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthContextProvider>{children}</AuthContextProvider>
    </SessionProvider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
