import { z } from "zod"

// リストステータス
export const listStatusSchema = z.enum(["in_progress", "completed"])

export type ListStatus = z.infer<typeof listStatusSchema>

// リスト作成
export const createListSchema = z.object({
  name: z.string().min(1, "名前は必須です").max(100, "名前は100文字以内です"),
  tagIds: z.array(z.string().uuid()).optional(), // タグでフィルタしてアイテムを追加
  itemIds: z.array(z.string().uuid()).optional(), // 直接アイテムを指定
  groupId: z.string().uuid().optional(),
})

export type CreateListInput = z.infer<typeof createListSchema>

// リストにアイテム追加
export const addItemToListSchema = z.object({
  listId: z.string().uuid(),
  itemId: z.string().uuid(),
})

export type AddItemToListInput = z.infer<typeof addItemToListSchema>

// アイテムのチェック切り替え
export const checkItemSchema = z.object({
  listItemId: z.string().uuid(),
  checked: z.boolean(),
})

export type CheckItemInput = z.infer<typeof checkItemSchema>

// 買い物完了
export const finishShoppingSchema = z.object({
  listId: z.string().uuid(),
  location: z.string().max(100, "場所は100文字以内です").optional(),
})

export type FinishShoppingInput = z.infer<typeof finishShoppingSchema>

// リスト取得クエリ
export const getListsQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
  status: listStatusSchema.optional(),
})

export type GetListsQuery = z.infer<typeof getListsQuerySchema>

// リストアイテム取得クエリ
export const getListItemsQuerySchema = z.object({
  listId: z.string().uuid(),
})

export type GetListItemsQuery = z.infer<typeof getListItemsQuerySchema>
