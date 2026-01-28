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
    })
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
export const syncMergeInputSchema = z.object({
  data: z.object({
    items: z.array(z.record(z.string(), z.unknown())),
    tags: z.array(z.record(z.string(), z.unknown())),
    lists: z.array(z.record(z.string(), z.unknown())),
    listItems: z.array(z.record(z.string(), z.unknown())),
    history: z.array(z.record(z.string(), z.unknown())),
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
