import type {
  SyncOperation,
  CreateSyncOperationInput,
  SyncEntity,
  EntityAccess,
} from "../entities/SyncOperation"

/**
 * 同期リポジトリインターフェース
 */
export interface SyncRepository {
  /**
   * 同期操作を記録
   */
  createOperation(input: CreateSyncOperationInput): Promise<SyncOperation>

  /**
   * 複数の同期操作を一括記録
   */
  createOperations(inputs: CreateSyncOperationInput[]): Promise<SyncOperation[]>

  /**
   * 指定日時以降の同期操作を取得
   */
  findOperationsSince(
    userId: string,
    groupIds: string[],
    since?: Date
  ): Promise<SyncOperation[]>

  /**
   * エンティティの最新状態（最も新しい同期操作）を取得
   * @param options.userId 指定時はそのユーザー自身の操作ログに限定する
   */
  findLatestEntityState(
    entity: SyncEntity,
    entityId: string,
    options?: { userId?: string }
  ): Promise<SyncOperation | null>

  /**
   * ユーザーがエンティティにアクセスできるか判定
   */
  checkEntityAccess(
    entity: SyncEntity,
    entityId: string,
    userId: string
  ): Promise<EntityAccess>

  /**
   * 同期操作を同期済みとしてマーク
   */
  markAsSynced(operationIds: string[]): Promise<void>

  /**
   * ユーザーの未同期操作数を取得
   */
  countPendingOperations(userId: string): Promise<number>
}
