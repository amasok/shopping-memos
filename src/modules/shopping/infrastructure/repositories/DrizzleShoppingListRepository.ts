import { eq, and, or, inArray, isNull, isNotNull, desc } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  shoppingLists,
  listItems,
  tags,
  groupMembers,
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

/**
 * Drizzleを使用した買い物リストリポジトリ実装
 */
export class DrizzleShoppingListRepository implements ShoppingListRepository {
  // === リスト操作 ===

  async create(input: CreateShoppingListInput): Promise<ShoppingList> {
    const now = new Date()

    const [list] = await db
      .insert(shoppingLists)
      .values({
        id: input.id,
        name: input.name,
        status: ListStatus.IN_PROGRESS,
        userId: input.userId,
        groupId: input.groupId ?? null,
        createdAt: now,
      })
      .returning()

    return {
      ...list,
      status: list.status as ListStatus,
    }
  }

  async findById(id: string): Promise<ShoppingListWithItems | null> {
    const result = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.id, id))

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
    const conditions = []

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

  async update(input: UpdateShoppingListInput): Promise<ShoppingList> {
    const updateData: Partial<typeof shoppingLists.$inferInsert> = {}

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
      .where(eq(shoppingLists.id, input.id))
      .returning()

    return {
      ...updated,
      status: updated.status as ListStatus,
    }
  }

  async delete(id: string): Promise<void> {
    await db.delete(shoppingLists).where(eq(shoppingLists.id, id))
  }

  // === リストアイテム操作 ===

  async addItem(input: CreateListItemInput): Promise<ListItem> {
    const now = new Date()

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
        createdAt: now,
      })
      .returning()

    return item
  }

  async updateItem(input: UpdateListItemInput): Promise<ListItem> {
    const updateData: Partial<typeof listItems.$inferInsert> = {}

    if (input.checked !== undefined) {
      updateData.checked = input.checked
    }

    const [updated] = await db
      .update(listItems)
      .set(updateData)
      .where(eq(listItems.id, input.id))
      .returning()

    return updated
  }

  async removeItem(id: string): Promise<void> {
    await db.delete(listItems).where(eq(listItems.id, id))
  }

  async findItemById(id: string): Promise<ListItem | null> {
    const result = await db
      .select()
      .from(listItems)
      .where(eq(listItems.id, id))

    return result[0] ?? null
  }

  // === アクセス制御 ===

  async canAccess(listId: string, userId: string): Promise<boolean> {
    const list = await db
      .select({ groupId: shoppingLists.groupId, ownerId: shoppingLists.userId })
      .from(shoppingLists)
      .where(eq(shoppingLists.id, listId))

    if (list.length === 0) {
      return false
    }

    // グループなしのリストは作成者のみアクセス可能
    if (!list[0].groupId) {
      return list[0].ownerId === userId
    }

    // グループメンバーか確認
    const membership = await db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, list[0].groupId),
          eq(groupMembers.userId, userId)
        )
      )

    return membership.length > 0
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
    const conditions = [isNotNull(shoppingLists.purchasedAt)]

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

  async markAsPurchased(id: string, location?: string): Promise<ShoppingList> {
    const now = new Date()

    const [updated] = await db
      .update(shoppingLists)
      .set({
        purchasedAt: now,
        location: location ?? null,
        status: ListStatus.COMPLETED,
        completedAt: now,
      })
      .where(eq(shoppingLists.id, id))
      .returning()

    return {
      ...updated,
      status: updated.status as ListStatus,
    }
  }

  async markAsUnpurchased(id: string): Promise<ShoppingList> {
    const [updated] = await db
      .update(shoppingLists)
      .set({
        purchasedAt: null,
        location: null,
        status: ListStatus.IN_PROGRESS,
        completedAt: null,
      })
      .where(eq(shoppingLists.id, id))
      .returning()

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
      .where(eq(listItems.listId, listId))
      .orderBy(listItems.createdAt)

    const result: ListItemWithTags[] = []
    for (const item of itemsResult) {
      let itemTags: { id: string; name: string }[] = []

      if (item.tagIds && item.tagIds.length > 0) {
        const tagsResult = await db
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(inArray(tags.id, item.tagIds))

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
