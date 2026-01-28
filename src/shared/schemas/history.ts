import { z } from "zod"
import { paginationSchema, dateRangeSchema } from "./common"

// 履歴取得クエリ
export const getHistoryQuerySchema = z
  .object({
    groupId: z.string().uuid().optional(),
  })
  .merge(paginationSchema)
  .merge(dateRangeSchema)

export type GetHistoryQuery = z.infer<typeof getHistoryQuerySchema>

// 履歴からアイテムを戻す
export const revertHistorySchema = z.object({
  historyId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1, "アイテムを1つ以上選択してください"),
})

export type RevertHistoryInput = z.infer<typeof revertHistorySchema>

// 履歴削除
export const deleteHistorySchema = z.object({
  id: z.string().uuid(),
})

export type DeleteHistoryInput = z.infer<typeof deleteHistorySchema>
