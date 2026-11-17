import { eq, and, sql, isNull, inArray } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"
import { db } from "@/infrastructure/db/drizzle/client"
import { accessibleByUser, canAccessScope, type DbExecutor } from "@/infrastructure/db/ownership"
import { RowNotFoundError, rethrowDuplicateId } from "@/infrastructure/db/errors"
import {
  createdFieldTimes,
  notDeleted,
  softDeleteValues,
  touchFields,
} from "@/infrastructure/db/syncColumns"
import { items, tags, itemTags } from "@/infrastructure/db/drizzle/schema"
import type { TagRepository } from "../../domain/repositories/TagRepository"
import type {
  Tag,
  CreateTagInput,
  UpdateTagInput,
  GetTagsQuery,
  TagWithUsageCount,
} from "../../domain/entities/Tag"

/** 更新・削除の対象: 論理削除されておらず、操作したユーザーが使えるタグ（#73-1） */
function writableTag(id: string, actorUserId: string) {
  return and(eq(tags.id, id), notDeleted(tags), accessibleByUser(tags, actorUserId))
}

/**
 * Drizzleを使用したタグリポジトリ実装
 *
 * 削除は論理削除（deleted_at）。取得系は削除済みを返さない（#62 O3b）
 */
export class DrizzleTagRepository implements TagRepository {
  async create(input: CreateTagInput): Promise<Tag> {
    // created_at / updated_at は DB の既定値（now()）にする
    const [tag] = await db
      .insert(tags)
      .values({
        id: input.id,
        name: input.name,
        userId: input.userId,
        groupId: input.groupId ?? null,
        fieldModifiedAt: createdFieldTimes(["name"]),
      })
      .returning()
      .catch((error: unknown) => rethrowDuplicateId(error, "tags", "タグ"))

    return tag
  }

  async findById(id: string): Promise<Tag | null> {
    const result = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), notDeleted(tags)))

    return result[0] ?? null
  }

  async findMany(query: GetTagsQuery): Promise<TagWithUsageCount[]> {
    // 基本のクエリ条件を構築（論理削除済みは返さない）
    const conditions = [notDeleted(tags)]

    // グループフィルタ
    // groupId が指定されている場合はグループタグ
    // groupId が null で userId が指定されている場合は個人タグ
    if (query.groupId) {
      conditions.push(eq(tags.groupId, query.groupId))
    } else if (query.userId) {
      // 個人タグ: groupId = null かつ userId が一致
      conditions.push(isNull(tags.groupId))
      conditions.push(eq(tags.userId, query.userId))
    } else {
      // スコープ条件なしの検索は全ユーザーのタグを返してしまうため禁止
      throw new Error("findMany には groupId または userId の指定が必要です")
    }

    // タグを取得
    const tagsResult = await db
      .select()
      .from(tags)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(tags.name)

    // 各タグの使用数を取得（論理削除済みのアイテムは数えない）
    const result: TagWithUsageCount[] = []
    for (const tag of tagsResult) {
      const usageCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemTags)
        .innerJoin(items, eq(itemTags.itemId, items.id))
        .where(and(eq(itemTags.tagId, tag.id), notDeleted(items)))

      result.push({
        ...tag,
        usageCount: Number(usageCountResult[0]?.count ?? 0),
      })
    }

    return result
  }

  async update(input: UpdateTagInput, actorUserId: string): Promise<Tag> {
    const updateData: PgUpdateSetSource<typeof tags> = {
      ...touchFields(tags, input.name !== undefined ? ["name"] : []),
    }

    if (input.name !== undefined) {
      updateData.name = input.name
    }

    const [updated] = await db
      .update(tags)
      .set(updateData)
      .where(writableTag(input.id, actorUserId))
      .returning()
    if (!updated) {
      throw new RowNotFoundError("タグ")
    }

    return updated
  }

  async delete(id: string, actorUserId: string, executor?: DbExecutor): Promise<void> {
    // 論理削除。タグの関連は消し、関連を外したアイテムの updated_at / tagIds のキーを更新する
    // （中間テーブルの削除は pull で伝わらないので、アイテムの変更として伝える）
    // executor を渡すと、そのトランザクションの中で行う（sync.push の 1 操作 1 トランザクション。#62 O4）
    if (executor) {
      return this.softDelete(executor, id, actorUserId)
    }
    await db.transaction((tx) => this.softDelete(tx, id, actorUserId))
  }

  private async softDelete(tx: DbExecutor, id: string, actorUserId: string): Promise<void> {
    const deleted = await tx
      .update(tags)
      .set(softDeleteValues())
      .where(writableTag(id, actorUserId))
      .returning({ id: tags.id })
    if (deleted.length === 0) {
      throw new RowNotFoundError("タグ")
    }
    const unlinked = await tx
      .delete(itemTags)
      .where(eq(itemTags.tagId, id))
      .returning({ itemId: itemTags.itemId })
    if (unlinked.length > 0) {
      await tx
        .update(items)
        .set(touchFields(items, ["tagIds"]))
        .where(inArray(items.id, unlinked.map((row) => row.itemId)))
    }
  }

  async canAccess(tagId: string, userId: string): Promise<boolean> {
    // タグを取得
    const tag = await this.findById(tagId)
    if (!tag) {
      return false
    }

    // グループのタグはメンバー、個人のタグは作成者だけ（共通の判定。#101）
    return canAccessScope(db, tag, userId)
  }
}

// シングルトンインスタンス
export const tagRepository = new DrizzleTagRepository()
