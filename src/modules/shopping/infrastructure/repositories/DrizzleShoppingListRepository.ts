import { eq, and, or, inArray, isNull, isNotNull, desc, type SQL } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"
import { db } from "@/infrastructure/db/drizzle/client"
import { accessibleByUser, canAccessScope } from "@/infrastructure/db/ownership"
import { RowNotFoundError, rethrowDuplicateId } from "@/infrastructure/db/errors"
import {
  createdFieldTimes,
  definedFields,
  notDeleted,
  softDeleteValues,
  touchFields,
} from "@/infrastructure/db/syncColumns"
import {
  shoppingLists,
  listItems,
  tags,
} from "@/infrastructure/db/drizzle/schema"
import type { ShoppingListRepository } from "../../domain/repositories/ShoppingListRepository"
import type {
  ShoppingList,
  ShoppingListWithItems,
  CreateShoppingListInput,
  UpdateShoppingListInput,
  GetShoppingListsQuery,
  GetPurchaseHistoryQuery,
  ListItemWithTags,
} from "../../domain/entities/ShoppingList"
import type {
  ListItem,
  CreateListItemInput,
  UpdateListItemInput,
} from "../../domain/entities/ListItem"
import { ListStatus } from "../../domain/value-objects/ListStatus"

/** field_modified_at に記録するフィールド（API のフィールド名） */
const LIST_FIELDS = ["name", "status", "completedAt", "purchasedAt", "location"] as const
const LIST_ITEM_FIELDS = ["name", "quantity", "memo", "tagIds", "checked"] as const

/** 更新・削除の対象: 論理削除されておらず、操作したユーザーが使えるリスト（#73-1） */
function writableList(id: string, actorUserId: string) {
  return and(eq(shoppingLists.id, id), notDeleted(shoppingLists), accessibleByUser(shoppingLists, actorUserId))
}

/**
 * 更新・削除の対象: 論理削除されておらず、操作したユーザーが使えるリストのアイテム。
 * リストのアイテムの user_id は入っていないことがあるので、親のリストで判定する
 */
function writableListItem(id: string, actorUserId: string) {
  return and(
    eq(listItems.id, id),
    notDeleted(listItems),
    inArray(
      listItems.listId,
      db
        .select({ id: shoppingLists.id })
        .from(shoppingLists)
        .where(and(notDeleted(shoppingLists), accessibleByUser(shoppingLists, actorUserId)))
    )
  )
}

/**
 * Drizzleを使用した買い物リストリポジトリ実装
 *
 * 削除は論理削除（deleted_at）。取得系は削除済みを返さない。更新・削除は updated_at / field_modified_at を
 * DB の now() で更新し、WHERE に操作したユーザーのスコープを付ける（#62 O3b）
 */
export class DrizzleShoppingListRepository implements ShoppingListRepository {
  // === リスト操作 ===

  async create(input: CreateShoppingListInput): Promise<ShoppingList> {
    // created_at / updated_at は DB の既定値（now()）にする
    const [list] = await db
      .insert(shoppingLists)
      .values({
        id: input.id,
        name: input.name,
        status: ListStatus.IN_PROGRESS,
        userId: input.userId,
        groupId: input.groupId ?? null,
        fieldModifiedAt: createdFieldTimes(LIST_FIELDS),
      })
      .returning()
      .catch((error: unknown) => rethrowDuplicateId(error, "shopping_lists", "リスト"))

    return {
      ...list,
      status: list.status as ListStatus,
    }
  }

  async findById(id: string): Promise<ShoppingListWithItems | null> {
    const result = await db
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, id), notDeleted(shoppingLists)))

    if (result.length === 0) {
      return null
    }

    const list = result[0]
    const items = await this.getListItemsWithTags(id)

    return {
      ...list,
      status: list.status as ListStatus,
      items,
    }
  }

  async findMany(query: GetShoppingListsQuery): Promise<ShoppingListWithItems[]> {
    // 論理削除済みは返さない
    const conditions: (SQL | undefined)[] = [notDeleted(shoppingLists)]

    // groupIdフィルタ:
    // - includeAllGroups: true → アクセス可能なグループ + 個人リストのみ
    // - groupIdが指定されている → そのグループのリストのみ
    // - groupIdがundefined → 個人リスト（groupId IS NULL かつ userId一致）のみ
    if (query.includeAllGroups) {
      // includeAllGroups時: アクセス可能なグループ + 個人リストのみ
      const accessConditions = []

      // 個人リスト（自分が作成したもの）
      if (query.userId) {
        accessConditions.push(
          and(isNull(shoppingLists.groupId), eq(shoppingLists.userId, query.userId))
        )
      }

      // アクセス可能なグループのリスト
      if (query.accessibleGroupIds && query.accessibleGroupIds.length > 0) {
        accessConditions.push(inArray(shoppingLists.groupId, query.accessibleGroupIds))
      }

      // どちらかの条件に一致するもの
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions))
      }
    } else {
      if (query.groupId !== undefined) {
        conditions.push(eq(shoppingLists.groupId, query.groupId))
      } else {
        conditions.push(isNull(shoppingLists.groupId))
        // 個人データはuserIdでフィルタ（セキュリティ上必須）
        if (query.userId) {
          conditions.push(eq(shoppingLists.userId, query.userId))
        }
      }
    }

    if (query.status) {
      conditions.push(eq(shoppingLists.status, query.status))
    } else if (!query.includeCompleted) {
      conditions.push(eq(shoppingLists.status, ListStatus.IN_PROGRESS))
    }

    const listsResult = await db
      .select()
      .from(shoppingLists)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(shoppingLists.createdAt)

    const result: ShoppingListWithItems[] = []
    for (const list of listsResult) {
      const items = await this.getListItemsWithTags(list.id)
      result.push({
        ...list,
        status: list.status as ListStatus,
        items,
      })
    }

    return result
  }

  async update(input: UpdateShoppingListInput, actorUserId: string): Promise<ShoppingList> {
    const updateData: PgUpdateSetSource<typeof shoppingLists> = {
      ...touchFields(shoppingLists, definedFields(input, [...LIST_FIELDS])),
    }

    if (input.name !== undefined) {
      updateData.name = input.name
    }
    if (input.status !== undefined) {
      updateData.status = input.status
    }
    if (input.completedAt !== undefined) {
      updateData.completedAt = input.completedAt
    }
    if (input.purchasedAt !== undefined) {
      updateData.purchasedAt = input.purchasedAt
    }
    if (input.location !== undefined) {
      updateData.location = input.location
    }

    const [updated] = await db
      .update(shoppingLists)
      .set(updateData)
      .where(writableList(input.id, actorUserId))
      .returning()
    if (!updated) {
      throw new RowNotFoundError("リスト")
    }

    return {
      ...updated,
      status: updated.status as ListStatus,
    }
  }

  async delete(id: string, actorUserId: string): Promise<void> {
    // リストとリストのアイテムを論理削除する（物理削除の cascade の代わり）
    await db.transaction(async (tx) => {
      const deleted = await tx
        .update(shoppingLists)
        .set(softDeleteValues())
        .where(writableList(id, actorUserId))
        .returning({ id: shoppingLists.id })
      if (deleted.length === 0) {
        throw new RowNotFoundError("リスト")
      }
      await tx
        .update(listItems)
        .set(softDeleteValues())
        .where(and(eq(listItems.listId, id), notDeleted(listItems)))
    })
  }

  // === リストアイテム操作 ===

  async addItem(input: CreateListItemInput): Promise<ListItem> {
    // created_at / updated_at は DB の既定値（now()）にする
    const [item] = await db
      .insert(listItems)
      .values({
        id: input.id,
        listId: input.listId,
        name: input.name,
        quantity: input.quantity,
        memo: input.memo ?? null,
        tagIds: input.tagIds ?? null,
        groupId: input.groupId ?? null,
        checked: false,
        fieldModifiedAt: createdFieldTimes(LIST_ITEM_FIELDS),
      })
      .returning()
      .catch((error: unknown) => rethrowDuplicateId(error, "list_items", "リストのアイテム"))

    return item
  }

  async updateItem(input: UpdateListItemInput, actorUserId: string): Promise<ListItem> {
    const updateData: PgUpdateSetSource<typeof listItems> = {
      ...touchFields(listItems, definedFields(input, ["checked"])),
    }

    if (input.checked !== undefined) {
      updateData.checked = input.checked
    }

    const [updated] = await db
      .update(listItems)
      .set(updateData)
      .where(writableListItem(input.id, actorUserId))
      .returning()
    if (!updated) {
      throw new RowNotFoundError("リストのアイテム")
    }

    return updated
  }

  async removeItem(id: string, actorUserId: string): Promise<void> {
    const removed = await db
      .update(listItems)
      .set(softDeleteValues())
      .where(writableListItem(id, actorUserId))
      .returning({ id: listItems.id })
    if (removed.length === 0) {
      throw new RowNotFoundError("リストのアイテム")
    }
  }

  async findItemById(id: string): Promise<ListItem | null> {
    const result = await db
      .select()
      .from(listItems)
      .where(and(eq(listItems.id, id), notDeleted(listItems)))

    return result[0] ?? null
  }

  // === アクセス制御 ===

  async canAccess(listId: string, userId: string): Promise<boolean> {
    const list = await db
      .select({ groupId: shoppingLists.groupId, ownerId: shoppingLists.userId })
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), notDeleted(shoppingLists)))

    if (list.length === 0) {
      return false
    }

    // グループのリストはメンバー、個人のリストは作成者だけ（共通の判定。#101）
    return canAccessScope(db, { userId: list[0].ownerId, groupId: list[0].groupId }, userId)
  }

  async canAccessItem(itemId: string, userId: string): Promise<boolean> {
    const item = await this.findItemById(itemId)
    if (!item) {
      return false
    }

    return this.canAccess(item.listId, userId)
  }

  // === 購入履歴操作 ===

  async findPurchaseHistory(query: GetPurchaseHistoryQuery): Promise<ShoppingListWithItems[]> {
    const conditions = [isNotNull(shoppingLists.purchasedAt), notDeleted(shoppingLists)]

    if (query.groupId !== undefined) {
      conditions.push(eq(shoppingLists.groupId, query.groupId))
    } else {
      conditions.push(isNull(shoppingLists.groupId))
      // 個人データはuserIdでフィルタ（セキュリティ上必須）
      if (query.userId) {
        conditions.push(eq(shoppingLists.userId, query.userId))
      }
    }

    let dbQuery = db
      .select()
      .from(shoppingLists)
      .where(and(...conditions))
      .orderBy(desc(shoppingLists.purchasedAt))
      .$dynamic()

    if (query.limit) {
      dbQuery = dbQuery.limit(query.limit)
    }
    if (query.offset) {
      dbQuery = dbQuery.offset(query.offset)
    }

    const listsResult = await dbQuery

    const result: ShoppingListWithItems[] = []
    for (const list of listsResult) {
      const items = await this.getListItemsWithTags(list.id)
      result.push({
        ...list,
        status: list.status as ListStatus,
        items,
      })
    }

    return result
  }

  async markAsPurchased(id: string, actorUserId: string, location?: string): Promise<ShoppingList> {
    const now = new Date()

    const [updated] = await db
      .update(shoppingLists)
      .set({
        purchasedAt: now,
        location: location ?? null,
        status: ListStatus.COMPLETED,
        completedAt: now,
        ...touchFields(shoppingLists, ["purchasedAt", "location", "status", "completedAt"]),
      })
      .where(writableList(id, actorUserId))
      .returning()
    if (!updated) {
      throw new RowNotFoundError("リスト")
    }

    return {
      ...updated,
      status: updated.status as ListStatus,
    }
  }

  async markAsUnpurchased(id: string, actorUserId: string): Promise<ShoppingList> {
    const [updated] = await db
      .update(shoppingLists)
      .set({
        purchasedAt: null,
        location: null,
        status: ListStatus.IN_PROGRESS,
        completedAt: null,
        ...touchFields(shoppingLists, ["purchasedAt", "location", "status", "completedAt"]),
      })
      .where(writableList(id, actorUserId))
      .returning()
    if (!updated) {
      throw new RowNotFoundError("リスト")
    }

    return {
      ...updated,
      status: updated.status as ListStatus,
    }
  }

  // === プライベートメソッド ===

  private async getListItemsWithTags(listId: string): Promise<ListItemWithTags[]> {
    const itemsResult = await db
      .select()
      .from(listItems)
      .where(and(eq(listItems.listId, listId), notDeleted(listItems)))
      .orderBy(listItems.createdAt)

    const result: ListItemWithTags[] = []
    for (const item of itemsResult) {
      let itemTags: { id: string; name: string }[] = []

      if (item.tagIds && item.tagIds.length > 0) {
        const tagsResult = await db
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(and(inArray(tags.id, item.tagIds), notDeleted(tags)))

        itemTags = tagsResult
      }

      result.push({
        ...item,
        tags: itemTags,
      })
    }

    return result
  }
}

// シングルトンインスタンス
export const shoppingListRepository = new DrizzleShoppingListRepository()
