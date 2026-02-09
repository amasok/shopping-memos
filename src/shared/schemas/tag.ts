import { z } from "zod"

// タグ作成
export const createTagSchema = z.object({
  name: z.string().min(1, "名前は必須です").max(50, "名前は50文字以内です"),
  groupId: z.string().uuid().optional(),
})

export type CreateTagInput = z.infer<typeof createTagSchema>

// タグ更新
export const updateTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "名前は必須です").max(50, "名前は50文字以内です").optional(),
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
