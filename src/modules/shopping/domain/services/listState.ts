import type { ListStatus } from "../value-objects/ListStatus"

/** 完了・取り消しがまとめて変えるリストのフィールド（sync.push の LWW の比較にも使う） */
export const LIST_STATE_FIELDS = ["status", "completedAt", "purchasedAt", "location"] as const

/** リストの状態のフィールド（完了・取り消しで書き換えるもの） */
export interface ListStateValues {
  status: ListStatus
  completedAt: Date | null
  purchasedAt: Date | null
  location: string | null
}

/** 日時の値（サーバーは Date、Dexie は ISO 文字列で持つ） */
export type DateValue = Date | string | null | undefined

/** 重複を除いた名前の一覧（最初に出た順） */
export function uniqueNames(entries: readonly { name: string }[]): string[] {
  return [...new Set(entries.map((e) => e.name))]
}
