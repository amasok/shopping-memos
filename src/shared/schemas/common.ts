import { z } from "./z"

// ID
export const idSchema = z.string().uuid()

// ページネーション
export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
})

export type Pagination = z.infer<typeof paginationSchema>

// 日付範囲
export const dateRangeSchema = z.object({
  from: z.date().optional(),
  to: z.date().optional(),
})

export type DateRange = z.infer<typeof dateRangeSchema>

// グループスコープ（多くのクエリで使用）
export const groupScopeSchema = z.object({
  groupId: z.string().uuid().optional(),
})

export type GroupScope = z.infer<typeof groupScopeSchema>
