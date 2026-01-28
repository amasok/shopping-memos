import { eq, and, inArray, isNull, isNotNull, like, or } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import {
  items,
  tags,
  itemTags,
  groupMembers,
} from "@/infrastructure/db/drizzle/schema"
import type { ItemRepository } from "../../domain/repositories/ItemRepository"
import type {
  Item,
  CreateItemInput,
  UpdateItemInput,
  GetItemsQuery,
  ItemWithTags,
} from "../../domain/entities/Item"

/**
 * Drizzleを使用したアイテムリポジトリ実装
 */
export class DrizzleItemRepository implements ItemRepository {
  async create(input: CreateItemInput): Promise<Item> {
    const now = new Date()

    const [item] = await db
      .insert(items)
      .values({
        id: input.id,
        name: input.name,
        quantity: input.quantity,
        memo: input.memo ?? null,
        groupId: input.groupId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    // タグを関連付け
    if (input.tagIds && input.tagIds.length > 0) {
      await db.insert(itemTags).values(
        input.tagIds.map((tagId) => ({
          itemId: input.id,
          tagId,
        }))
      )
    }

    return item
  }

  async findById(id: string): Promise<ItemWithTags | null> {
    const result = await db.select().from(items).where(eq(items.id, id))

    if (result.length === 0) {
      return null
    }

    const item = result[0]

    // タグを取得
    const itemTagsResult = await db
      .select({
        id: tags.id,
        name: tags.name,
      })
      .from(itemTags)
      .innerJoin(tags, eq(itemTags.tagId, tags.id))
      .where(eq(itemTags.itemId, id))

    return {
      ...item,
      tags: itemTagsResult,
    }
  }

  async findMany(query: GetItemsQuery): Promise<ItemWithTags[]> {
    // 基本のクエリ条件を構築
    const conditions = []

    // グループフィルタ
    if (query.groupId) {
      conditions.push(eq(items.groupId, query.groupId))
    }

    // 購入済み/未購入フィルタ
    if (!query.includePurchased) {
      conditions.push(isNull(items.purchasedAt))
    }

    // 検索テキスト
    if (query.searchText) {
      conditions.push(like(items.name, `%${query.searchText}%`))
    }

    // アイテムを取得
    const itemsResult = await db
      .select()
      .from(items)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(items.createdAt)

    // タグIDでフィルタリング（指定されたタグをすべて持つアイテム）
    let filteredItems = itemsResult
    if (query.tagIds && query.tagIds.length > 0) {
      const itemIdsWithTags = await db
        .select({ itemId: itemTags.itemId })
        .from(itemTags)
        .where(inArray(itemTags.tagId, query.tagIds))

      const itemIdSet = new Set(itemIdsWithTags.map((r) => r.itemId))
      filteredItems = itemsResult.filter((item) => itemIdSet.has(item.id))
    }

    // 各アイテムにタグを付与
    const result: ItemWithTags[] = []
    for (const item of filteredItems) {
      const itemTagsResult = await db
        .select({
          id: tags.id,
          name: tags.name,
        })
        .from(itemTags)
        .innerJoin(tags, eq(itemTags.tagId, tags.id))
        .where(eq(itemTags.itemId, item.id))

      result.push({
        ...item,
        tags: itemTagsResult,
      })
    }

    return result
  }

  async update(input: UpdateItemInput): Promise<Item> {
    const updateData: Partial<typeof items.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (input.name !== undefined) {
      updateData.name = input.name
    }
    if (input.quantity !== undefined) {
      updateData.quantity = input.quantity
    }
    if (input.memo !== undefined) {
      updateData.memo = input.memo
    }

    const [updated] = await db
      .update(items)
      .set(updateData)
      .where(eq(items.id, input.id))
      .returning()

    // タグを更新
    if (input.tagIds !== undefined) {
      // 既存のタグを削除
      await db.delete(itemTags).where(eq(itemTags.itemId, input.id))

      // 新しいタグを追加
      if (input.tagIds.length > 0) {
        await db.insert(itemTags).values(
          input.tagIds.map((tagId) => ({
            itemId: input.id,
            tagId,
          }))
        )
      }
    }

    return updated
  }

  async delete(id: string): Promise<void> {
    // itemTagsはonDelete: cascadeなので自動削除
    await db.delete(items).where(eq(items.id, id))
  }

  async markAsPurchased(id: string): Promise<Item> {
    const [updated] = await db
      .update(items)
      .set({
        purchasedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(items.id, id))
      .returning()

    return updated
  }

  async markAsUnpurchased(id: string): Promise<Item> {
    const [updated] = await db
      .update(items)
      .set({
        purchasedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(items.id, id))
      .returning()

    return updated
  }

  async canAccess(itemId: string, userId: string): Promise<boolean> {
    // アイテムを取得
    const item = await this.findById(itemId)
    if (!item) {
      return false
    }

    // グループなしのアイテムは誰でもアクセス可能（ゲストモード）
    if (!item.groupId) {
      return true
    }

    // グループメンバーか確認
    const membership = await db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, item.groupId),
          eq(groupMembers.userId, userId)
        )
      )

    return membership.length > 0
  }
}

// シングルトンインスタンス
export const itemRepository = new DrizzleItemRepository()
