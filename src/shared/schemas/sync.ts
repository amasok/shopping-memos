import { z } from "zod"
import {
  MERGE_LIMITS,
  REQUEST_LIMITS,
  TEXT_LIMITS,
  boundedRecordSchema,
} from "./limits"

// 既存の import（@/shared/schemas/sync の MERGE_LIMITS）のために再エクスポートする
export { MERGE_LIMITS }

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
  payload: boundedRecordSchema,
  createdAt: z.coerce.date(),
  retryCount: z.number().int().min(0).default(0),
})

export type SyncQueueItem = z.infer<typeof syncQueueItemSchema>

/**
 * 同期プッシュリクエスト
 */
export const syncPushInputSchema = z.object({
  operations: z
    .array(
      z.object({
        id: z.string().uuid(),
        entity: syncEntitySchema,
        entityId: z.string().uuid(),
        operation: syncOperationTypeSchema,
        payload: boundedRecordSchema,
        createdAt: z.coerce.date(),
      }),
    )
    .max(REQUEST_LIMITS.pushOperations),
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
  groupIds: z.array(z.string().uuid()).max(REQUEST_LIMITS.groupIds).optional(),
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
// マージ入力の上限（MERGE_LIMITS）は limits.ts に置く

// 日付は ISO 文字列（または Date）。Invalid Date は拒否する。null / undefined は coerce せずにそのまま通す
const mergeDate = z.coerce.date()
const mergeId = z.string().uuid()
const mergeTagIds = z.array(mergeId).max(MERGE_LIMITS.tagIdsPerEntity)
const mergeQuantity = z.number().int().min(1).max(TEXT_LIMITS.quantityMax)
const mergeMemo = z.string().max(TEXT_LIMITS.memo).nullish()

// 文字数の上限は、各エンティティの作成スキーマ（item / tag / list）に合わせる。
// 未知のキーは取り除かれる（クライアントが余分な項目を送っても受け付ける）
export const mergeItemSchema = z.object({
  id: mergeId,
  name: z.string().min(1).max(TEXT_LIMITS.itemName),
  quantity: mergeQuantity,
  memo: mergeMemo,
  tagIds: mergeTagIds,
  purchasedAt: mergeDate.nullish(),
  createdAt: mergeDate,
})

export const mergeTagSchema = z.object({
  id: mergeId,
  name: z.string().min(1).max(TEXT_LIMITS.tagName),
  createdAt: mergeDate,
})

export const mergeListSchema = z.object({
  id: mergeId,
  name: z.string().min(1).max(TEXT_LIMITS.listName),
  status: z.enum(["in_progress", "completed"]),
  createdAt: mergeDate,
  completedAt: mergeDate.nullish(),
  purchasedAt: mergeDate.nullish(),
  location: z.string().max(TEXT_LIMITS.location).nullish(),
})

export const mergeListItemSchema = z.object({
  id: mergeId,
  listId: mergeId,
  name: z.string().min(1).max(TEXT_LIMITS.listItemName),
  quantity: mergeQuantity,
  memo: mergeMemo,
  tagIds: mergeTagIds,
  checked: z.boolean(),
  createdAt: mergeDate,
})

export const mergeHistorySchema = z.object({
  id: mergeId,
  listId: mergeId,
  location: z.string().max(TEXT_LIMITS.location).nullish(),
  purchasedAt: mergeDate,
})

/** 1 件ごとの検証に使う、厳密な入力（`data` 部分） */
export const syncMergeDataSchema = z.object({
  items: z.array(mergeItemSchema).max(MERGE_LIMITS.items),
  tags: z.array(mergeTagSchema).max(MERGE_LIMITS.tags),
  lists: z.array(mergeListSchema).max(MERGE_LIMITS.lists),
  listItems: z.array(mergeListItemSchema).max(MERGE_LIMITS.listItems),
  history: z.array(mergeHistorySchema).max(MERGE_LIMITS.history),
})

export const syncMergeStrictInputSchema = z.object({ data: syncMergeDataSchema })

export type MergeData = z.infer<typeof syncMergeDataSchema>

/**
 * tRPC の入力スキーマ。配列の件数の上限だけをここで検証し（超えると BAD_REQUEST）、
 * 各要素は `parseMergeData` で 1 件ずつ検証する。
 * 形式が不正な 1 件（UUID でないなど）のために、ほかの正しいデータまで取り込めなくならないようにする
 */
export const syncMergeInputSchema = z.object({
  data: z.object({
    items: z.array(z.unknown()).max(MERGE_LIMITS.items),
    tags: z.array(z.unknown()).max(MERGE_LIMITS.tags),
    lists: z.array(z.unknown()).max(MERGE_LIMITS.lists),
    listItems: z.array(z.unknown()).max(MERGE_LIMITS.listItems),
    history: z.array(z.unknown()).max(MERGE_LIMITS.history),
  }),
})

const MERGE_ENTITY_LABELS = {
  items: "アイテム",
  tags: "タグ",
  lists: "リスト",
  listItems: "リストアイテム",
  history: "履歴",
} as const

/**
 * `syncMergeInputSchema` を通った入力を、要素ごとに検証する。
 * 合わない要素はエラー文にして取り除き、残りを返す（データの中身はエラー文に含めない）
 */
export function parseMergeData(input: z.infer<typeof syncMergeInputSchema>["data"]): {
  data: MergeData
  errors: string[]
} {
  const errors: string[] = []
  const pick = <T>(key: keyof typeof MERGE_ENTITY_LABELS, schema: z.ZodType<T>): T[] => {
    const valid: T[] = []
    input[key].forEach((raw, index) => {
      const result = schema.safeParse(raw)
      if (result.success) {
        valid.push(result.data)
      } else {
        const field = result.error.issues[0]?.path.join(".") || "(全体)"
        errors.push(`${MERGE_ENTITY_LABELS[key]} ${index + 1} 件目の形式が不正なためスキップ（${field}）`)
      }
    })
    return valid
  }
  return {
    data: {
      items: pick("items", mergeItemSchema),
      tags: pick("tags", mergeTagSchema),
      lists: pick("lists", mergeListSchema),
      listItems: pick("listItems", mergeListItemSchema),
      history: pick("history", mergeHistorySchema),
    },
    errors,
  }
}

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
