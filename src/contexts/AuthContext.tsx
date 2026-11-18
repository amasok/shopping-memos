"use client"

import { createContext, useCallback, useContext } from "react"
import { authClient } from "@/infrastructure/auth/client"
import { loginUrl } from "@/lib/auth/callbackUrl"
import { clearLoginScopedState, ensureGuestDataMigrated } from "@/lib/db/guestData"

export interface User {
  id: string
  name: string
  email: string
  avatarUrl?: string
}

/** #62 の O9 で "offline" を足す */
export type AuthStatus = "authenticated" | "unauthenticated" | "loading"

interface AuthContextType {
  user: User | null
  status: AuthStatus
  isLoading: boolean
  /**
   * セッションの有無が確かか（正常な応答か 401）。通信のエラー（ページを離れるときに切れた通信・オフライン）や
   * サーバーのエラーでは false。false の間は、画面はゲストとして出すが、ログイン中だけの状態
   * （選んでいたグループ・merge 済みの印）は消さない
   */
  sessionKnown: boolean
  /** ログイン画面へ移る（今いる画面を戻り先にする） */
  login: () => Promise<void>
  logout: () => Promise<void>
  /** この端末を含む、すべての端末のセッションを無効にする（#61 A4） */
  logoutAllDevices: () => Promise<void>
  /** セッションを取り直す（表示名を保存した後に、user.name を新しい値にする。#61 A4） */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * ログインの状態（#61 A3a 4.1。design の D5）
 *
 * Better Auth のクライアントの useSession を包む。tRPC の Context と useAuth() の使い方は変えない
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isPending, error, refetch } = authClient.useSession()

  const user: User | null = data?.user
    ? {
        id: data.user.id,
        name: data.user.name ?? "",
        email: data.user.email ?? "",
        avatarUrl: data.user.image ?? undefined,
      }
    : null
  const status: AuthStatus = isPending ? "loading" : user ? "authenticated" : "unauthenticated"
  // 401 以外のエラー（通信のエラー・ページを離れるときに切れた通信・サーバーのエラー）でセッションがないときは、
  // ログインしているかわからない。画面はゲストとして出す（オフラインでもゲストの DB で表示できるように）が、
  // ログイン中だけの状態は消さない。ログイン中の取り直しのエラーでは、Better Auth が前のセッションを残すので authenticated のまま
  const sessionKnown = !isPending && (!!user || !error || (error as { status?: number }).status === 401)

  const login = useCallback(async () => {
    window.location.assign(loginUrl(`${window.location.pathname}${window.location.search}`))
  }, [])

  const logoutAllDevices = useCallback(async () => {
    // 今の logout と同じく、ログイン中だけの状態を消してから、すべてのセッションを無効にする
    if (await ensureGuestDataMigrated()) clearLoginScopedState()
    await authClient.revokeSessions()
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/")
  }, [])

  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])

  const logout = useCallback(async () => {
    // ログイン中だけの状態（merge 済みの印・選んでいたグループ）を消してからログアウトする。
    // ゲストのデータは merge が全部成功したときに空になっているので、ログアウト後は空のゲストになる
    // 以前の印は移行の判定に使うので、移行が終わってから消す（失敗したら残し、次の読み込みでやり直す）
    if (await ensureGuestDataMigrated()) clearLoginScopedState()
    await authClient.signOut()
    // 画面の状態（React Query のキャッシュなど）を残さないよう、ホームを読み込み直す（router.push では残る）
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/")
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, status, isLoading: status === "loading", sessionKnown, login, logout, logoutAllDevices, refresh }}
    >
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
