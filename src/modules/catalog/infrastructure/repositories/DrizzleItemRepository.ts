import { eq, and, inArray, isNull, like } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"
import { db } from "@/infrastructure/db/drizzle/client"
import { accessibleByUser, canAccessScope, type DbExecutor } from "@/infrastructure/db/ownership"
import { RowNotFoundError, rethrowDuplicateId } from "@/infrastructure/db/errors"
import {
  createdFieldTimes,
  definedFields,
  notDeleted,
  softDeleteValues,
  touchFields,
} from "@/infrastructure/db/syncColumns"
import {
  items,
  tags,
  itemTags,
} from "@/infrastructure/db/drizzle/schema"
import type { ItemRepository } from "../../domain/repositories/ItemRepository"
import type {
  Item,
  CreateItemInput,
  UpdateItemInput,
  GetItemsQuery,
  ItemWithTags,
} from "../../domain/entities/Item"

/** field_modified_at に記録するアイテムのフィールド（API のフィールド名） */
const ITEM_FIELDS = ["name", "quantity", "memo", "tagIds", "purchasedAt"] as const

/** 更新・削除の対象: 論理削除されておらず、操作したユーザーが使えるアイテム（#73-1） */
function writableItem(id: string, actorUserId: string) {
  return and(eq(items.id, id), notDeleted(items), accessibleByUser(items, actorUserId))
}

/**
 * Drizzleを使用したアイテムリポジトリ実装
 *
 * 削除は論理削除（deleted_at）。取得系は削除済みを返さない。更新・削除は updated_at / field_modified_at を
 * DB の now() で更新し、WHERE に操作したユーザーのスコープを付ける（#62 O3b）
 */
export class DrizzleItemRepository implements ItemRepository {
  async create(input: CreateItemInput): Promise<Item> {
    // created_at / updated_at は DB の既定値（now()）にする
    const [item] = await db
      .insert(items)
      .values({
        id: input.id,
        name: input.name,
        quantity: input.quantity,
        memo: input.memo ?? null,
        userId: input.userId,
        groupId: input.groupId ?? null,
        fieldModifiedAt: createdFieldTimes(ITEM_FIELDS),
      })
      .returning()
      .catch((error: unknown) => rethrowDuplicateId(error, "items", "アイテム"))

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
    const result = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), notDeleted(items)))

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
      .where(and(eq(itemTags.itemId, id), notDeleted(tags)))

    return {
      ...item,
      tags: itemTagsResult,
    }
  }

  async findMany(query: GetItemsQuery): Promise<ItemWithTags[]> {
    // 基本のクエリ条件を構築（論理削除済みは返さない）
    const conditions = [notDeleted(items)]

    // グループフィルタ
    // groupId が指定されている場合はグループアイテム
    // groupId が null で userId が指定されている場合は個人アイテム
    if (query.groupId) {
      conditions.push(eq(items.groupId, query.groupId))
    } else if (query.userId) {
      // 個人アイテム: groupId = null かつ userId が一致
      conditions.push(isNull(items.groupId))
      conditions.push(eq(items.userId, query.userId))
    } else {
      // スコープ条件なしの検索は全ユーザーのアイテムを返してしまうため禁止
      throw new Error("findMany には groupId または userId の指定が必要です")
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
        // 削除済みのタグでは絞り込まない（タグの削除で関連も消すが、念のため）
        .innerJoin(tags, eq(itemTags.tagId, tags.id))
        .where(and(inArray(itemTags.tagId, query.tagIds), notDeleted(tags)))

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
        .where(and(eq(itemTags.itemId, item.id), notDeleted(tags)))

      result.push({
        ...item,
        tags: itemTagsResult,
      })
    }

    return result
  }

  async update(input: UpdateItemInput, actorUserId: string): Promise<Item> {
    const updateData: PgUpdateSetSource<typeof items> = {
      ...touchFields(items, definedFields(input, ["name", "quantity", "memo", "tagIds"])),
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

    // 行の更新とタグの入れ替えを 1 つのトランザクションにする。
    // 行の UPDATE で行ロックを取るので、間に削除が入って削除済みのアイテムにタグが付き直ることはない
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(items)
        .set(updateData)
        .where(writableItem(input.id, actorUserId))
        .returning()
      if (!updated) {
        throw new RowNotFoundError("アイテム")
      }

      // タグを更新
      if (input.tagIds !== undefined) {
        // 既存のタグを削除
        await tx.delete(itemTags).where(eq(itemTags.itemId, input.id))

        // 新しいタグを追加
        if (input.tagIds.length > 0) {
          await tx.insert(itemTags).values(
            input.tagIds.map((tagId) => ({
              itemId: input.id,
              tagId,
            }))
          )
        }
      }

      return updated
    })
  }

  async delete(id: string, actorUserId: string, executor?: DbExecutor): Promise<void> {
    // 論理削除。tombstone にタグは要らないので、タグの関連は消す（タグの使用数にも数えない）
    // executor を渡すと、そのトランザクションの中で行う（sync.push の 1 操作 1 トランザクション。#62 O4）
    if (executor) {
      return this.softDelete(executor, id, actorUserId)
    }
    await db.transaction((tx) => this.softDelete(tx, id, actorUserId))
  }

  private async softDelete(executor: DbExecutor, id: string, actorUserId: string): Promise<void> {
    const deleted = await executor
      .update(items)
      .set(softDeleteValues())
      .where(writableItem(id, actorUserId))
      .returning({ id: items.id })
    if (deleted.length === 0) {
      throw new RowNotFoundError("アイテム")
    }
    await executor.delete(itemTags).where(eq(itemTags.itemId, id))
  }

  async markAsPurchased(id: string, actorUserId: string): Promise<Item> {
    return this.setPurchasedAt(id, actorUserId, new Date())
  }

  async markAsUnpurchased(id: string, actorUserId: string): Promise<Item> {
    return this.setPurchasedAt(id, actorUserId, null)
  }

  private async setPurchasedAt(id: string, actorUserId: string, purchasedAt: Date | null): Promise<Item> {
    const [updated] = await db
      .update(items)
      .set({ purchasedAt, ...touchFields(items, ["purchasedAt"]) })
      .where(writableItem(id, actorUserId))
      .returning()
    if (!updated) {
      throw new RowNotFoundError("アイテム")
    }
    return updated
  }

  async canAccess(itemId: string, userId: string): Promise<boolean> {
    // アイテムを取得
    const item = await this.findById(itemId)
    if (!item) {
      return false
    }

    // グループのアイテムはメンバー、個人のアイテムは作成者だけ（共通の判定。#101）
    return canAccessScope(db, item, userId)
  }
}

// シングルトンインスタンス
export const itemRepository = new DrizzleItemRepository()
