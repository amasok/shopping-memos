import { z } from "./z"
import { TEXT_LIMITS } from "./limits"

// タグ作成
export const createTagSchema = z.object({
  // クライアントで採番した ID（#62 O3b）。省略するとサーバーで採番する。使用済みなら CONFLICT
  id: z.string().uuid().optional(),
  name: z.string().min(1, "名前は必須です").max(TEXT_LIMITS.tagName, `名前は${TEXT_LIMITS.tagName}文字以内です`),
  groupId: z.string().uuid().optional(),
})

export type CreateTagInput = z.infer<typeof createTagSchema>

// タグ更新
export const updateTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "名前は必須です").max(TEXT_LIMITS.tagName, `名前は${TEXT_LIMITS.tagName}文字以内です`).optional(),
})

export type UpdateTagInput = z.infer<typeof updateTagSchema>

// タグ削除
export const deleteTagSchema = z.object({
  id: z.string().uuid(),
})

export type DeleteTagInput = z.infer<typeof deleteTagSchema>

// タグ取得クエリ
export const getTagsQuerySchema = z.object({
  groupId: z.string().uuid().nullish(), // undefined または null を許可
})

export type GetTagsQuery = z.infer<typeof getTagsQuerySchema>
