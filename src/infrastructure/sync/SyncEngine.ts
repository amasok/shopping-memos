import {
  db,
  generateId,
  type SyncQueueItem,
  type ShoppingItem,
  type Tag,
  type ShoppingList,
  type ListItem,
  type PurchaseHistory,
} from "@/lib/db"
import type { SyncEntity, SyncOperationType } from "@/modules/sync/domain/entities/SyncOperation"

/**
 * 同期エンジン
 * クライアント側の同期処理を管理
 */
export class SyncEngine {
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true
  private isSyncing = false
  private listeners: Set<() => void> = new Set()

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.handleOnline())
      window.addEventListener("offline", () => this.handleOffline())
    }
  }

  /**
   * オンライン状態を取得
   */
  getIsOnline(): boolean {
    return this.isOnline
  }

  /**
   * 同期中かどうかを取得
   */
  getIsSyncing(): boolean {
    return this.isSyncing
  }

  /**
   * 状態変更リスナーを登録
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener())
  }

  private handleOnline(): void {
    this.isOnline = true
    this.notifyListeners()
    // オンラインになったら自動同期
    this.syncPendingOperations().catch(console.error)
  }

  private handleOffline(): void {
    this.isOnline = false
    this.notifyListeners()
  }

  /**
   * 同期キューに操作を追加
   */
  async addToQueue(
    entity: SyncEntity,
    entityId: string,
    operation: SyncOperationType,
    payload: Record<string, unknown>
  ): Promise<void> {
    const item: SyncQueueItem = {
      id: generateId(),
      entity,
      entityId,
      operation,
      payload: JSON.stringify(payload),
      createdAt: new Date(),
      retryCount: 0,
    }

    await db.syncQueue.add(item)
    this.notifyListeners()

    // オンラインなら即座に同期試行
    if (this.isOnline && !this.isSyncing) {
      this.syncPendingOperations().catch(console.error)
    }
  }

  /**
   * 同期キューの件数を取得
   */
  async getPendingCount(): Promise<number> {
    return db.syncQueue.count()
  }

  /**
   * 同期キューをクリア
   */
  async clearQueue(ids: string[]): Promise<void> {
    await db.syncQueue.bulkDelete(ids)
    this.notifyListeners()
  }

  /**
   * 保留中の操作をサーバーに同期
   * このメソッドは外部からtRPCクライアントを渡して実行される
   */
  async syncPendingOperations(
    pushFn?: (
      operations: Array<{
        id: string
        entity: string
        entityId: string
        operation: string
        payload: Record<string, unknown>
        createdAt: Date
      }>
    ) => Promise<{ processedIds: string[]; conflicts: Array<unknown> }>
  ): Promise<void> {
    if (!this.isOnline || this.isSyncing) {
      return
    }

    if (!pushFn) {
      // tRPCクライアントが渡されていない場合はスキップ
      return
    }

    const pendingOps = await db.syncQueue.toArray()
    if (pendingOps.length === 0) {
      return
    }

    this.isSyncing = true
    this.notifyListeners()

    try {
      const operations = pendingOps.map((op) => ({
        id: op.id,
        entity: op.entity,
        entityId: op.entityId,
        operation: op.operation,
        payload: JSON.parse(op.payload) as Record<string, unknown>,
        createdAt: op.createdAt,
      }))

      const result = await pushFn(operations)

      // 成功した操作をキューから削除
      if (result.processedIds.length > 0) {
        await this.clearQueue(result.processedIds)
      }

      // 競合があればローカルを更新（Last Write Wins）
      if (result.conflicts.length > 0) {
        for (const conflict of result.conflicts) {
          await this.applyServerValue(conflict as {
            operationId: string
            entity: SyncEntity
            entityId: string
            serverData: Record<string, unknown>
          })
        }
      }
    } catch (error) {
      // ネットワークエラーは無視（次回リトライ）
      console.error("Sync failed:", error)
    } finally {
      this.isSyncing = false
      this.notifyListeners()
    }
  }

  /**
   * サーバーの値をローカルに適用
   */
  private async applyServerValue(conflict: {
    operationId: string
    entity: SyncEntity
    entityId: string
    serverData: Record<string, unknown>
  }): Promise<void> {
    const { entity, entityId, serverData } = conflict

    // 該当する操作をキューから削除
    await db.syncQueue.where("id").equals(conflict.operationId).delete()

    // ローカルDBを更新（putで完全置き換え）
    switch (entity) {
      case "item":
        await db.items.put(serverData as Parameters<typeof db.items.put>[0])
        break
      case "tag":
        await db.tags.put(serverData as Parameters<typeof db.tags.put>[0])
        break
      case "list":
        await db.lists.put(serverData as Parameters<typeof db.lists.put>[0])
        break
      case "listItem":
        await db.listItems.put(serverData as Parameters<typeof db.listItems.put>[0])
        break
      case "history":
        await db.history.put(serverData as Parameters<typeof db.history.put>[0])
        break
    }
  }

  /**
   * サーバーから変更をプル
   */
  async pullChanges(
    pullFn: (since?: Date) => Promise<{
      items: Array<Record<string, unknown>>
      tags: Array<Record<string, unknown>>
      lists: Array<Record<string, unknown>>
      listItems: Array<Record<string, unknown>>
      history: Array<Record<string, unknown>>
      syncedAt: Date
    }>,
    since?: Date
  ): Promise<void> {
    if (!this.isOnline) {
      return
    }

    this.isSyncing = true
    this.notifyListeners()

    try {
      const changes = await pullFn(since)

      // 各エンティティをローカルDBに適用
      // bulkPutを使用して既存データを上書き
      if (changes.items.length > 0) {
        await db.items.bulkPut(changes.items as unknown as ShoppingItem[])
      }
      if (changes.tags.length > 0) {
        await db.tags.bulkPut(changes.tags as unknown as Tag[])
      }
      if (changes.lists.length > 0) {
        await db.lists.bulkPut(changes.lists as unknown as ShoppingList[])
      }
      if (changes.listItems.length > 0) {
        await db.listItems.bulkPut(changes.listItems as unknown as ListItem[])
      }
      if (changes.history.length > 0) {
        await db.history.bulkPut(changes.history as unknown as PurchaseHistory[])
      }

      // 最終同期日時を保存
      localStorage.setItem("lastSyncAt", changes.syncedAt.toISOString())
    } catch (error) {
      console.error("Pull failed:", error)
      throw error
    } finally {
      this.isSyncing = false
      this.notifyListeners()
    }
  }

  /**
   * 初回ログイン時のマージ
   */
  async mergeLocalData(
    mergeFn: (data: {
      items: Array<Record<string, unknown>>
      tags: Array<Record<string, unknown>>
      lists: Array<Record<string, unknown>>
      listItems: Array<Record<string, unknown>>
      history: Array<Record<string, unknown>>
    }) => Promise<{
      idMappings: Array<{ entity: string; localId: string; serverId: string }>
      serverData: {
        items: Array<Record<string, unknown>>
        tags: Array<Record<string, unknown>>
        lists: Array<Record<string, unknown>>
        listItems: Array<Record<string, unknown>>
        history: Array<Record<string, unknown>>
        syncedAt: Date
      }
    }>
  ): Promise<void> {
    if (!this.isOnline) {
      throw new Error("オフライン状態ではマージできません")
    }

    this.isSyncing = true
    this.notifyListeners()

    try {
      // ローカルデータを収集
      const localData = {
        items: (await db.items.toArray()) as unknown as Array<Record<string, unknown>>,
        tags: (await db.tags.toArray()) as unknown as Array<Record<string, unknown>>,
        lists: (await db.lists.toArray()) as unknown as Array<Record<string, unknown>>,
        listItems: (await db.listItems.toArray()) as unknown as Array<Record<string, unknown>>,
        history: (await db.history.toArray()) as unknown as Array<Record<string, unknown>>,
      }

      // サーバーにマージリクエスト
      const result = await mergeFn(localData)

      // IDマッピングを適用（必要な場合）
      if (result.idMappings.length > 0) {
        await this.applyIdMappings(result.idMappings)
      }

      // サーバーデータをローカルに反映
      const { serverData } = result
      if (serverData.items.length > 0) {
        await db.items.bulkPut(serverData.items as unknown as ShoppingItem[])
      }
      if (serverData.tags.length > 0) {
        await db.tags.bulkPut(serverData.tags as unknown as Tag[])
      }
      if (serverData.lists.length > 0) {
        await db.lists.bulkPut(serverData.lists as unknown as ShoppingList[])
      }
      if (serverData.listItems.length > 0) {
        await db.listItems.bulkPut(serverData.listItems as unknown as ListItem[])
      }
      if (serverData.history.length > 0) {
        await db.history.bulkPut(serverData.history as unknown as PurchaseHistory[])
      }

      // 同期キューをクリア
      await db.syncQueue.clear()

      // 同期完了フラグを設定
      localStorage.setItem("syncedAt", serverData.syncedAt.toISOString())
    } catch (error) {
      console.error("Merge failed:", error)
      throw error
    } finally {
      this.isSyncing = false
      this.notifyListeners()
    }
  }

  /**
   * IDマッピングを適用
   */
  private async applyIdMappings(
    mappings: Array<{ entity: string; localId: string; serverId: string }>
  ): Promise<void> {
    for (const mapping of mappings) {
      const { entity, localId, serverId } = mapping

      switch (entity) {
        case "item": {
          const item = await db.items.get(localId)
          if (item) {
            await db.items.delete(localId)
            await db.items.add({ ...item, id: serverId })
          }
          break
        }
        case "tag": {
          const tag = await db.tags.get(localId)
          if (tag) {
            await db.tags.delete(localId)
            await db.tags.add({ ...tag, id: serverId })
          }
          break
        }
        case "list": {
          const list = await db.lists.get(localId)
          if (list) {
            await db.lists.delete(localId)
            await db.lists.add({ ...list, id: serverId })
          }
          break
        }
        case "listItem": {
          const listItem = await db.listItems.get(localId)
          if (listItem) {
            await db.listItems.delete(localId)
            await db.listItems.add({ ...listItem, id: serverId })
          }
          break
        }
        case "history": {
          const historyItem = await db.history.get(localId)
          if (historyItem) {
            await db.history.delete(localId)
            await db.history.add({ ...historyItem, id: serverId })
          }
          break
        }
      }
    }
  }
}

// シングルトンインスタンス
export const syncEngine = new SyncEngine()
