import { and, eq } from "drizzle-orm"
import type { DrizzleDB } from "@/infrastructure/db/drizzle/client"
import {
  items,
  tags,
  shoppingLists,
  listItems,
  groupMembers,
} from "@/infrastructure/db/drizzle/schema"
import type { SyncEntity, EntityAccess } from "../domain/entities/SyncOperation"

/**
 * DB実行コンテキスト（db 本体またはトランザクション）
 */
export type DbExecutor = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0]

/**
 * データの所有スコープ
 * - groupId あり: グループのデータ（メンバーのみアクセス可）
 * - groupId なし: userId（作成者）の個人データ
 */
export interface OwnerScope {
  userId: string | null
  groupId: string | null
}

/**
 * スコープにユーザーがアクセスできるか判定する
 */
export async function canAccessScope(
  executor: DbExecutor,
  scope: OwnerScope,
  userId: string
): Promise<boolean> {
  if (!scope.groupId) {
    return scope.userId !== null && scope.userId === userId
  }

  const membership = await executor
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, scope.groupId), eq(groupMembers.userId, userId)))
    .limit(1)

  return membership.length > 0
}

/**
 * エンティティの所有スコープを取得する
 * listItem は所属リストのスコープで判定する
 */
export async function findEntityScope(
  executor: DbExecutor,
  entity: SyncEntity,
  entityId: string
): Promise<OwnerScope | null> {
  switch (entity) {
    case "item": {
      const [row] = await executor
        .select({ userId: items.userId, groupId: items.groupId })
        .from(items)
        .where(eq(items.id, entityId))
      return row ?? null
    }
    case "tag": {
      const [row] = await executor
        .select({ userId: tags.userId, groupId: tags.groupId })
        .from(tags)
        .where(eq(tags.id, entityId))
      return row ?? null
    }
    case "list":
    case "history": {
      return findListScope(executor, entityId)
    }
    case "listItem": {
      const [row] = await executor
        .select({ userId: shoppingLists.userId, groupId: shoppingLists.groupId })
        .from(listItems)
        .innerJoin(shoppingLists, eq(listItems.listId, shoppingLists.id))
        .where(eq(listItems.id, entityId))
      return row ?? null
    }
    default:
      return null
  }
}

/**
 * リストの所有スコープを取得する
 */
export async function findListScope(
  executor: DbExecutor,
  listId: string
): Promise<OwnerScope | null> {
  const [row] = await executor
    .select({ userId: shoppingLists.userId, groupId: shoppingLists.groupId })
    .from(shoppingLists)
    .where(eq(shoppingLists.id, listId))
  return row ?? null
}

/**
 * エンティティへのアクセス可否を判定する
 */
export async function checkEntityAccess(
  executor: DbExecutor,
  entity: SyncEntity,
  entityId: string,
  userId: string
): Promise<EntityAccess> {
  const scope = await findEntityScope(executor, entity, entityId)
  if (!scope) {
    return "not_found"
  }
  return (await canAccessScope(executor, scope, userId)) ? "allowed" : "denied"
}
