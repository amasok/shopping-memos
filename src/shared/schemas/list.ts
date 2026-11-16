import { z } from "zod"
import { TEXT_LIMITS } from "./limits"

// リストステータス
export const listStatusSchema = z.enum(["in_progress", "completed"])

export type ListStatus = z.infer<typeof listStatusSchema>

// リスト作成
export const createListSchema = z.object({
  name: z.string().min(1, "名前は必須です").max(TEXT_LIMITS.listName, `名前は${TEXT_LIMITS.listName}文字以内です`),
  tagIds: z.array(z.string().uuid()).optional(), // タグでフィルタしてアイテムを追加
  itemIds: z.array(z.string().uuid()).optional(), // 直接アイテムを指定
  groupId: z.string().uuid().optional(),
})

export type CreateListInput = z.infer<typeof createListSchema>

// リストにアイテム追加（既存アイテムを追加）
export const addItemToListSchema = z.object({
  listId: z.string().uuid(),
  itemId: z.string().uuid(),
})

export type AddItemToListInput = z.infer<typeof addItemToListSchema>

// リストに新規アイテム追加（直接入力）
export const addNewItemToListSchema = z.object({
  listId: z.string().uuid(),
  name: z.string().min(1, "名前は必須です").max(TEXT_LIMITS.listName, `名前は${TEXT_LIMITS.listName}文字以内です`),
  quantity: z.number().int().min(1).default(1),
  memo: z.string().max(TEXT_LIMITS.memo, `メモは${TEXT_LIMITS.memo}文字以内です`).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
})

export type AddNewItemToListInput = z.infer<typeof addNewItemToListSchema>

// アイテムのチェック切り替え
export const checkItemSchema = z.object({
  listItemId: z.string().uuid(),
  checked: z.boolean(),
})

export type CheckItemInput = z.infer<typeof checkItemSchema>

// 買い物完了
export const finishShoppingSchema = z.object({
  listId: z.string().uuid(),
  location: z.string().max(TEXT_LIMITS.location, `場所は${TEXT_LIMITS.location}文字以内です`).optional(),
})

export type FinishShoppingInput = z.infer<typeof finishShoppingSchema>

// リスト取得クエリ
export const getListsQuerySchema = z.object({
  groupId: z.string().uuid().nullish(), // undefined または null を許可
  status: listStatusSchema.optional(),
  includeCompleted: z.boolean().optional(),
  /** trueの場合、groupIdフィルタを無視して全リストを返す */
  includeAllGroups: z.boolean().optional(),
})

export type GetListsQuery = z.infer<typeof getListsQuerySchema>

// リスト更新
export const updateListSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "名前は必須です").max(TEXT_LIMITS.listName, `名前は${TEXT_LIMITS.listName}文字以内です`).optional(),
})

export type UpdateListInput = z.infer<typeof updateListSchema>

// リスト削除
export const deleteListSchema = z.object({
  id: z.string().uuid(),
})

export type DeleteListInput = z.infer<typeof deleteListSchema>

// リストアイテム削除
export const removeListItemSchema = z.object({
  id: z.string().uuid(),
})

export type RemoveListItemInput = z.infer<typeof removeListItemSchema>

// リストアイテム取得クエリ
export const getListItemsQuerySchema = z.object({
  listId: z.string().uuid(),
})

export type GetListItemsQuery = z.infer<typeof getListItemsQuerySchema>
