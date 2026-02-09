"use client"

import { useDataMerge } from "@/contexts/DataMergeContext"
import { cn } from "@/lib/utils"
import { Cloud, AlertCircle, CheckCircle, RefreshCw } from "lucide-react"

/**
 * データマージ状態の表示コンポーネント
 * ログイン時にローカルデータをサーバーに同期中の状態を表示
 */
export function DataMergeStatus() {
  const { isMerging, isMergeCompleted, error, mergedCounts, retryMerge } = useDataMerge()

  // マージ中でなく、エラーもなく、完了済みなら何も表示しない
  if (!isMerging && !error && isMergeCompleted) {
    return null
  }

  // マージ中でもエラーでもない場合（まだ開始していない）は何も表示しない
  if (!isMerging && !error && !isMergeCompleted) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 max-w-sm rounded-xl bg-white p-6 shadow-xl">
        {isMerging && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
              <Cloud className="h-8 w-8 animate-pulse text-blue-600" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              データを同期中...
            </h2>
            <p className="text-sm text-gray-600">
              ローカルデータをサーバーにアップロードしています
            </p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              同期に失敗しました
            </h2>
            <p className="mb-4 text-sm text-gray-600">{error}</p>
            <button
              type="button"
              onClick={retryMerge}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2",
                "bg-blue-600 text-white",
                "hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              )}
            >
              <RefreshCw className="h-4 w-4" />
              再試行
            </button>
          </div>
        )}

        {isMergeCompleted && mergedCounts && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              同期が完了しました
            </h2>
            <div className="mb-4 text-sm text-gray-600">
              <p>アイテム: {mergedCounts.items}件</p>
              <p>タグ: {mergedCounts.tags}件</p>
              <p>リスト: {mergedCounts.lists}件</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
