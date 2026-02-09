"use client"

import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"
import { useDataMerge } from "@/contexts/DataMergeContext"
import { useEffect } from "react"

// 開発環境でのログ出力
const isDev = process.env.NODE_ENV !== "production"

/**
 * データソースを判定するフック
 *
 * サーバーファースト方式:
 * - ログイン中かつマージ完了: サーバー (tRPC) を使用
 * - ログイン中だがマージ未完了: ローカル (Dexie) を使用（マージ中）
 * - 未ログイン: ローカル (Dexie) を使用（オフライン対応）
 *
 * ログイン後は個人アイテム（groupId = null）もサーバーに保存されているため、
 * マージが完了したらサーバーを使用する。
 */
export function useDataSource() {
  const { user, isLoading } = useAuth()
  const { selectedGroupId } = useGroup()
  const { isMergeCompleted } = useDataMerge()

  const isLoggedIn = !!user

  // ログイン中かつマージ完了の場合のみサーバーを使用
  const useServer = isLoggedIn && isMergeCompleted

  // デバッグログ
  useEffect(() => {
    if (isDev) {
      console.log("[useDataSource]", {
        isLoggedIn,
        isMergeCompleted,
        useServer,
        selectedGroupId,
        userId: user?.id,
      })
    }
  }, [isLoggedIn, isMergeCompleted, useServer, selectedGroupId, user?.id])

  return {
    /** サーバー（tRPC）を使用すべきか（ログイン中かつマージ完了） */
    useServer,
    /** ローカル（Dexie）を使用すべきか */
    useLocal: !useServer,
    /** 認証状態の読み込み中か */
    isAuthLoading: isLoading,
    /** ログイン中のユーザー */
    user,
    /** 現在選択中のグループID */
    selectedGroupId,
    /** データマージが完了しているか */
    isMergeCompleted,
  }
}
