// z.object を作る前に Zod の JIT を止める（CSP の eval 違反を避ける。#71）
import "./zod-config"
import { z } from "zod"
import { paginationSchema, dateRangeSchema } from "./common"

// 履歴取得クエリ
export const getHistoryQuerySchema = z
  .object({
    groupId: z.string().uuid().nullish(), // undefined または null を許可
  })
  .merge(paginationSchema)
  .merge(dateRangeSchema)

export type GetHistoryQuery = z.infer<typeof getHistoryQuerySchema>

// 履歴からリストに戻す
export const revertHistorySchema = z.object({
  historyId: z.string().uuid(),
})

export type RevertHistoryInput = z.infer<typeof revertHistorySchema>

// 履歴削除
export const deleteHistorySchema = z.object({
  id: z.string().uuid(),
})

export type DeleteHistoryInput = z.infer<typeof deleteHistorySchema>
