"use client"

import { useAuth } from "@/contexts/AuthContext"

/**
 * データソースを判定するフック
 * ログイン時: server (tRPC)
 * 未ログイン時: local (Dexie)
 */
export function useDataSource() {
  const { user, isLoading } = useAuth()

  return {
    /** サーバー（tRPC）を使用すべきか */
    useServer: !!user,
    /** ローカル（Dexie）を使用すべきか */
    useLocal: !user,
    /** 認証状態の読み込み中か */
    isAuthLoading: isLoading,
    /** ログイン中のユーザー */
    user,
  }
}
