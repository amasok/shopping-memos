import { z } from "zod"

/**
 * 同期可能なエンティティタイプ
 */
export const syncEntitySchema = z.enum([
  "item",
  "tag",
  "list",
  "listItem",
  "history",
])

export type SyncEntity = z.infer<typeof syncEntitySchema>

/**
 * 同期操作タイプ
 */
export const syncOperationTypeSchema = z.enum(["create", "update", "delete"])

export type SyncOperationType = z.infer<typeof syncOperationTypeSchema>

/**
 * 同期キューアイテム（クライアント側）
 */
export const syncQueueItemSchema = z.object({
  id: z.string().uuid(),
  entity: syncEntitySchema,
  entityId: z.string().uuid(),
  operation: syncOperationTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
  retryCount: z.number().int().min(0).default(0),
})

export type SyncQueueItem = z.infer<typeof syncQueueItemSchema>

/**
 * 同期プッシュリクエスト
 */
export const syncPushInputSchema = z.object({
  operations: z.array(
    z.object({
      id: z.string().uuid(),
      entity: syncEntitySchema,
      entityId: z.string().uuid(),
      operation: syncOperationTypeSchema,
      payload: z.record(z.string(), z.unknown()),
      createdAt: z.coerce.date(),
    }),
  ),
})

export type SyncPushInput = z.infer<typeof syncPushInputSchema>

/**
 * 同期競合情報
 */
export const syncConflictSchema = z.object({
  operationId: z.string().uuid(),
  entity: syncEntitySchema,
  entityId: z.string().uuid(),
  serverData: z.record(z.string(), z.unknown()),
  serverUpdatedAt: z.coerce.date(),
})

export type SyncConflict = z.infer<typeof syncConflictSchema>

/**
 * 同期プッシュレスポンス
 */
export const syncPushOutputSchema = z.object({
  processedIds: z.array(z.string().uuid()),
  conflicts: z.array(syncConflictSchema),
})

export type SyncPushOutput = z.infer<typeof syncPushOutputSchema>

/**
 * 同期プルリクエスト
 */
export const syncPullInputSchema = z.object({
  since: z.coerce.date().optional(),
  groupIds: z.array(z.string().uuid()).optional(),
})

export type SyncPullInput = z.infer<typeof syncPullInputSchema>

/**
 * 同期プルレスポンス（エンティティごとの変更）
 */
export const syncPullOutputSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
  tags: z.array(z.record(z.string(), z.unknown())),
  lists: z.array(z.record(z.string(), z.unknown())),
  listItems: z.array(z.record(z.string(), z.unknown())),
  history: z.array(z.record(z.string(), z.unknown())),
  syncedAt: z.coerce.date(),
})

export type SyncPullOutput = z.infer<typeof syncPullOutputSchema>

/**
 * 初回ログイン時のマージリクエスト
 */
/** マージ入力の上限（巨大なペイロードで DB の容量や処理時間を消費されないようにする） */
export const MERGE_LIMITS = {
  items: 1000,
  tags: 500,
  lists: 500,
  listItems: 1000,
  history: 500,
  tagIdsPerEntity: 50,
  quantityMax: 9999,
  itemName: 100,
  tagName: 50,
  listName: 100,
  listItemName: 100,
  memo: 500,
  location: 100,
} as const

/** 文字数の上限に収める（ゲストの画面には入力長の上限がないため、送信前に切り詰める） */
export function clipText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/** 数量を、サーバーが受け付ける範囲（1〜quantityMax の整数）に収める */
export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MERGE_LIMITS.quantityMax, Math.max(1, Math.trunc(value)))
}

// 日付は ISO 文字列（または Date）。Invalid Date は拒否する。null / undefined は coerce せずにそのまま通す
const mergeDate = z.coerce.date()
const mergeId = z.string().uuid()
const mergeTagIds = z.array(mergeId).max(MERGE_LIMITS.tagIdsPerEntity)
const mergeQuantity = z.number().int().min(1).max(MERGE_LIMITS.quantityMax)
const mergeMemo = z.string().max(MERGE_LIMITS.memo).nullish()

// 文字数の上限は、各エンティティの作成スキーマ（item / tag / list）に合わせる。
// 未知のキーは取り除かれる（クライアントが余分な項目を送っても受け付ける）
export const mergeItemSchema = z.object({
  id: mergeId,
  name: z.string().min(1).max(MERGE_LIMITS.itemName),
  quantity: mergeQuantity,
  memo: mergeMemo,
  tagIds: mergeTagIds,
  purchasedAt: mergeDate.nullish(),
  createdAt: mergeDate,
})

export const mergeTagSchema = z.object({
  id: mergeId,
  name: z.string().min(1).max(MERGE_LIMITS.tagName),
  createdAt: mergeDate,
})

export const mergeListSchema = z.object({
  id: mergeId,
  name: z.string().min(1).max(MERGE_LIMITS.listName),
  status: z.enum(["in_progress", "completed"]),
  createdAt: mergeDate,
  completedAt: mergeDate.nullish(),
  purchasedAt: mergeDate.nullish(),
  location: z.string().max(MERGE_LIMITS.location).nullish(),
})

export const mergeListItemSchema = z.object({
  id: mergeId,
  listId: mergeId,
  name: z.string().min(1).max(MERGE_LIMITS.listItemName),
  quantity: mergeQuantity,
  memo: mergeMemo,
  tagIds: mergeTagIds,
  checked: z.boolean(),
  createdAt: mergeDate,
})

export const mergeHistorySchema = z.object({
  id: mergeId,
  listId: mergeId,
  location: z.string().max(MERGE_LIMITS.location).nullish(),
  purchasedAt: mergeDate,
})

export const syncMergeInputSchema = z.object({
  data: z.object({
    items: z.array(mergeItemSchema).max(MERGE_LIMITS.items),
    tags: z.array(mergeTagSchema).max(MERGE_LIMITS.tags),
    lists: z.array(mergeListSchema).max(MERGE_LIMITS.lists),
    listItems: z.array(mergeListItemSchema).max(MERGE_LIMITS.listItems),
    history: z.array(mergeHistorySchema).max(MERGE_LIMITS.history),
  }),
})

export type SyncMergeInput = z.infer<typeof syncMergeInputSchema>

/**
 * IDマッピング（ローカルID → サーバーID）
 */
export const idMappingSchema = z.object({
  entity: syncEntitySchema,
  localId: z.string().uuid(),
  serverId: z.string().uuid(),
})

export type IdMapping = z.infer<typeof idMappingSchema>

/**
 * マージレスポンス
 */
export const syncMergeOutputSchema = z.object({
  idMappings: z.array(idMappingSchema),
  serverData: syncPullOutputSchema,
})

export type SyncMergeOutput = z.infer<typeof syncMergeOutputSchema>
