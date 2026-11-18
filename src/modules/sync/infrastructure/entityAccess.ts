import { and, eq, type SQL } from "drizzle-orm"
import { notDeleted, type SyncTable } from "@/infrastructure/db/syncColumns"
import { items, tags, shoppingLists, listItems } from "@/infrastructure/db/drizzle/schema"
import { canAccessScope, type DbExecutor } from "@/infrastructure/db/ownership"
import type { OwnerScope } from "@/shared/domain/ownerScope"
import type { SyncEntity, EntityAccess } from "../domain/entities/SyncOperation"

// 所有スコープの型と純粋な判定（OwnerScope・isSameScope）は src/shared/domain/ownerScope.ts、
// DB を使う判定は src/infrastructure/db/ownership.ts に 1 つだけ置く（#101・#179）。ここからは再エクスポートしない（#151）

export interface ScopeLookupOptions {
  /**
   * 論理削除済みの行も対象にする（#62 O3b）。既定は対象外（削除済みは「見つからない」）。
   * ID の重なりの判定（その ID の行がすでにあるか）にだけ使う
   */
  includeDeleted?: boolean
}

/** id の一致に、必要なら deleted_at IS NULL を足した条件 */
function byId(table: SyncTable, idCondition: SQL, options: ScopeLookupOptions): SQL {
  return options.includeDeleted ? idCondition : (and(idCondition, notDeleted(table)) as SQL)
}

/**
 * エンティティの所有スコープを取得する
 * listItem は所属リストのスコープで判定する（リストのアイテムとリストのどちらかが削除済みなら、見つからない扱い）
 */
export async function findEntityScope(
  executor: DbExecutor,
  entity: SyncEntity,
  entityId: string,
  options: ScopeLookupOptions = {}
): Promise<OwnerScope | null> {
  switch (entity) {
    case "item": {
      const [row] = await executor
        .select({ userId: items.userId, groupId: items.groupId })
        .from(items)
        .where(byId(items, eq(items.id, entityId), options))
      return row ?? null
    }
    case "tag": {
      const [row] = await executor
        .select({ userId: tags.userId, groupId: tags.groupId })
        .from(tags)
        .where(byId(tags, eq(tags.id, entityId), options))
      return row ?? null
    }
    case "list":
    case "history": {
      return findListScope(executor, entityId, options)
    }
    case "listItem": {
      const [row] = await executor
        .select({ userId: shoppingLists.userId, groupId: shoppingLists.groupId })
        .from(listItems)
        .innerJoin(shoppingLists, eq(listItems.listId, shoppingLists.id))
        .where(
          options.includeDeleted
            ? eq(listItems.id, entityId)
            : and(eq(listItems.id, entityId), notDeleted(listItems), notDeleted(shoppingLists))
        )
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
  listId: string,
  options: ScopeLookupOptions = {}
): Promise<OwnerScope | null> {
  const [row] = await executor
    .select({ userId: shoppingLists.userId, groupId: shoppingLists.groupId })
    .from(shoppingLists)
    .where(byId(shoppingLists, eq(shoppingLists.id, listId), options))
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
