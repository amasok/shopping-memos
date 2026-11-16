import { z } from "zod"
import { TEXT_LIMITS } from "./limits"

// アイテム作成
export const createItemSchema = z.object({
  name: z.string().min(1, "名前は必須です").max(TEXT_LIMITS.itemName, `名前は${TEXT_LIMITS.itemName}文字以内です`),
  quantity: z.number().int().min(1, "数量は1以上です").max(TEXT_LIMITS.quantityMax, `数量は${TEXT_LIMITS.quantityMax}以下です`).default(1),
  memo: z.string().max(TEXT_LIMITS.memo, `メモは${TEXT_LIMITS.memo}文字以内です`).optional(),
  tagIds: z.array(z.string().uuid()).default([]),
  groupId: z.string().uuid().optional(),
})

export type CreateItemInput = z.infer<typeof createItemSchema>

// アイテム更新
export const updateItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "名前は必須です").max(TEXT_LIMITS.itemName, `名前は${TEXT_LIMITS.itemName}文字以内です`).optional(),
  quantity: z.number().int().min(1, "数量は1以上です").max(TEXT_LIMITS.quantityMax, `数量は${TEXT_LIMITS.quantityMax}以下です`).optional(),
  memo: z.string().max(TEXT_LIMITS.memo, `メモは${TEXT_LIMITS.memo}文字以内です`).nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
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
  tagIds: z.array(z.string().uuid()).optional(),
  searchText: z
    .string()
    .max(100)
    .transform((s) => s.replace(/[%_]/g, "\\$&")) // LIKE特殊文字をエスケープ
    .optional(),
  includePurchased: z.boolean().default(false),
})

export type GetItemsQuery = z.infer<typeof getItemsQuerySchema>
