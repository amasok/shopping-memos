/**
 * 買い物リストのステータス
 */
export const ListStatus = {
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
} as const

export type ListStatus = (typeof ListStatus)[keyof typeof ListStatus]

/**
 * ステータス遷移が有効かチェック
 * in_progress → completed のみ許可（一方通行）
 */
export function canTransition(from: ListStatus, to: ListStatus): boolean {
  if (from === ListStatus.IN_PROGRESS && to === ListStatus.COMPLETED) {
    return true
  }
  return false
}

/**
 * ステータスが進行中かチェック
 */
export function isInProgress(status: ListStatus): boolean {
  return status === ListStatus.IN_PROGRESS
}

/**
 * ステータスが完了かチェック
 */
export function isCompleted(status: ListStatus): boolean {
  return status === ListStatus.COMPLETED
}
