import { eq } from "drizzle-orm"
import { items, tags, shoppingLists, listItems } from "@/infrastructure/db/drizzle/schema"
import { canAccessScope, type DbExecutor, type OwnerScope } from "@/infrastructure/db/ownership"
import type { SyncEntity, EntityAccess } from "../domain/entities/SyncOperation"

// 所有スコープの型と判定は src/infrastructure/db/ownership.ts に 1 つだけ置く（#101）。
// ここからは再エクスポートしない（#151）

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
