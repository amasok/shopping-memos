/**
 * 同期可能なエンティティタイプ
 */
export type SyncEntity = "item" | "tag" | "list" | "listItem" | "history"

/**
 * 同期操作タイプ
 */
export type SyncOperationType = "create" | "update" | "delete"

/**
 * 同期操作エンティティ（サーバー側ログ）
 */
export interface SyncOperation {
  id: string
  userId: string
  entity: SyncEntity
  entityId: string
  operation: SyncOperationType
  payload: string // JSON文字列
  localId: string | null // マージ時のローカルID
  syncedAt: Date | null
  createdAt: Date
}

/**
 * 同期操作作成時の入力
 */
export interface CreateSyncOperationInput {
  id: string
  userId: string
  entity: SyncEntity
  entityId: string
  operation: SyncOperationType
  payload: Record<string, unknown>
  localId?: string
}

/**
 * 同期キューアイテム（クライアント側）
 */
export interface SyncQueueItem {
  id: string
  entity: SyncEntity
  entityId: string
  operation: SyncOperationType
  payload: Record<string, unknown>
  createdAt: Date
  retryCount: number
}

/**
 * 同期競合情報
 */
export interface SyncConflict {
  operationId: string
  entity: SyncEntity
  entityId: string
  serverData: Record<string, unknown>
  serverUpdatedAt: Date
}

/**
 * IDマッピング（ローカルID → サーバーID）
 */
export interface IdMapping {
  entity: SyncEntity
  localId: string
  serverId: string
}
