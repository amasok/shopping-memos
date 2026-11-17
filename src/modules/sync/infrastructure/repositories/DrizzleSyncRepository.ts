import { eq, and, gte, inArray, isNull, isNotNull } from "drizzle-orm"
import { notDeleted } from "@/infrastructure/db/syncColumns"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  syncOperations,
  items,
  tags,
  shoppingLists,
  listItems,
  groupMembers,
} from "@/infrastructure/db/drizzle/schema"
import type { SyncRepository } from "../../domain/repositories/SyncRepository"
import type {
  SyncOperation,
  CreateSyncOperationInput,
  SyncEntity,
} from "../../domain/entities/SyncOperation"

/**
 * Drizzleを使用した同期リポジトリ実装
 */
export class DrizzleSyncRepository implements SyncRepository {
  async createOperation(input: CreateSyncOperationInput): Promise<SyncOperation> {
    const now = new Date()

    const [operation] = await db
      .insert(syncOperations)
      .values({
        id: input.id,
        userId: input.userId,
        entity: input.entity,
        entityId: input.entityId,
        operation: input.operation,
        payload: JSON.stringify(input.payload),
        localId: input.localId ?? null,
        createdAt: now,
      })
      .returning()

    return this.mapToEntity(operation)
  }

  async createOperations(
    inputs: CreateSyncOperationInput[]
  ): Promise<SyncOperation[]> {
    if (inputs.length === 0) {
      return []
    }

    const now = new Date()

    const operations = await db
      .insert(syncOperations)
      .values(
        inputs.map((input) => ({
          id: input.id,
          userId: input.userId,
          entity: input.entity,
          entityId: input.entityId,
          operation: input.operation,
          payload: JSON.stringify(input.payload),
          localId: input.localId ?? null,
          createdAt: now,
        }))
      )
      .returning()

    return operations.map(this.mapToEntity)
  }

  async findOperationsSince(
    userId: string,
    groupIds: string[],
    since?: Date
  ): Promise<SyncOperation[]> {
    // ユーザーが所属するグループのIDを取得
    const userGroupMemberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))

    const accessibleGroupIds = userGroupMemberships.map((m) => m.groupId)

    // groupIdsパラメータがあればそれでフィルタ
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- TODO: 将来使用予定
    const _targetGroupIds =
      groupIds.length > 0
        ? groupIds.filter((id) => accessibleGroupIds.includes(id))
        : accessibleGroupIds

    // TODO: 実際のエンティティテーブルからgroupIdでフィルタする必要がある
    // 現状は単純にユーザーの操作ログを返す
    const conditions = since
      ? and(eq(syncOperations.userId, userId), gte(syncOperations.createdAt, since))
      : eq(syncOperations.userId, userId)

    const operations = await db
      .select()
      .from(syncOperations)
      .where(conditions)
      .orderBy(syncOperations.createdAt)

    return operations.map(this.mapToEntity)
  }

  async markAsSynced(operationIds: string[]): Promise<void> {
    if (operationIds.length === 0) {
      return
    }

    await db
      .update(syncOperations)
      .set({ syncedAt: new Date() })
      .where(inArray(syncOperations.id, operationIds))
  }

  async countPendingOperations(userId: string): Promise<number> {
    const result = await db
      .select({ id: syncOperations.id })
      .from(syncOperations)
      .where(
        and(eq(syncOperations.userId, userId), isNull(syncOperations.syncedAt))
      )

    return result.length
  }

  /**
   * 指定日時以降に更新されたエンティティデータを取得
   */
  async getChangedEntities(groupIds: string[], since?: Date) {
    const sinceDate = since ?? new Date(0)

    // 各エンティティテーブルから変更を取得
    const [itemsData, tagsData, listsData, listItemsData, historyData] =
      await Promise.all([
        groupIds.length > 0
          ? db
              .select()
              .from(items)
              .where(
                and(
                  inArray(items.groupId, groupIds),
                  gte(items.updatedAt, sinceDate),
                  notDeleted(items)
                )
              )
          : Promise.resolve([]),
        groupIds.length > 0
          ? db
              .select()
              .from(tags)
              .where(
                and(
                  inArray(tags.groupId, groupIds),
                  gte(tags.updatedAt, sinceDate),
                  notDeleted(tags)
                )
              )
          : Promise.resolve([]),
        groupIds.length > 0
          ? db
              .select()
              .from(shoppingLists)
              .where(
                and(
                  inArray(shoppingLists.groupId, groupIds),
                  gte(shoppingLists.createdAt, sinceDate),
                  notDeleted(shoppingLists)
                )
              )
          : Promise.resolve([]),
        groupIds.length > 0
          ? db
              .select()
              .from(listItems)
              .where(
                and(
                  inArray(listItems.groupId, groupIds),
                  gte(listItems.createdAt, sinceDate),
                  notDeleted(listItems)
                )
              )
          : Promise.resolve([]),
        // 履歴はshoppingListsのpurchasedAtが入っているレコード
        groupIds.length > 0
          ? db
              .select()
              .from(shoppingLists)
              .where(
                and(
                  inArray(shoppingLists.groupId, groupIds),
                  isNotNull(shoppingLists.purchasedAt),
                  gte(shoppingLists.purchasedAt, sinceDate),
                  notDeleted(shoppingLists)
                )
              )
          : Promise.resolve([]),
      ])

    return {
      items: itemsData,
      tags: tagsData,
      lists: listsData,
      listItems: listItemsData,
      history: historyData,
    }
  }

  private mapToEntity(row: typeof syncOperations.$inferSelect): SyncOperation {
    return {
      id: row.id,
      userId: row.userId,
      entity: row.entity as SyncEntity,
      entityId: row.entityId,
      operation: row.operation as SyncOperation["operation"],
      payload: row.payload,
      localId: row.localId,
      syncedAt: row.syncedAt,
      createdAt: row.createdAt,
    }
  }
}

// シングルトンインスタンス
export const syncRepository = new DrizzleSyncRepository()
