import { z } from "zod"
import { quantitySchema, tagIdsSchema } from "./limits"

// アイテム作成
export const createItemSchema = z.object({
  name: z.string().min(1, "名前は必須です").max(100, "名前は100文字以内です"),
  quantity: quantitySchema.default(1),
  memo: z.string().max(500, "メモは500文字以内です").optional(),
  tagIds: tagIdsSchema.default([]),
  groupId: z.string().uuid().optional(),
})

export type CreateItemInput = z.infer<typeof createItemSchema>

// アイテム更新
export const updateItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "名前は必須です").max(100, "名前は100文字以内です").optional(),
  quantity: quantitySchema.optional(),
  memo: z.string().max(500, "メモは500文字以内です").nullish(),
  tagIds: tagIdsSchema.optional(),
})

export type UpdateItemInput = z.infer<typeof updateItemSchema>

// アイテム削除
export const deleteItemSchema = z.object({
  id: z.string().uuid(),
})

export type DeleteItemInput = z.infer<typeof deleteItemSchema>

// アイテム取得クエリ
export const getItemsQuerySchema = z.object({
  groupId: z.string().uuid().nullish(), // undefined または null を許可
  tagIds: tagIdsSchema.optional(),
  searchText: z
    .string()
    .max(100)
    .transform((s) => s.replace(/[%_]/g, "\\$&")) // LIKE特殊文字をエスケープ
    .optional(),
  includePurchased: z.boolean().default(false),
})

export type GetItemsQuery = z.infer<typeof getItemsQuerySchema>
