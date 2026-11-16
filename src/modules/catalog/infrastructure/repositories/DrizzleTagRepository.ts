import { eq, and, sql, isNull } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { canAccessScope } from "@/infrastructure/db/ownership"
import { tags, itemTags } from "@/infrastructure/db/drizzle/schema"
import type { TagRepository } from "../../domain/repositories/TagRepository"
import type {
  Tag,
  CreateTagInput,
  UpdateTagInput,
  GetTagsQuery,
  TagWithUsageCount,
} from "../../domain/entities/Tag"

/**
 * Drizzleを使用したタグリポジトリ実装
 */
export class DrizzleTagRepository implements TagRepository {
  async create(input: CreateTagInput): Promise<Tag> {
    const now = new Date()

    const [tag] = await db
      .insert(tags)
      .values({
        id: input.id,
        name: input.name,
        userId: input.userId,
        groupId: input.groupId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return tag
  }

  async findById(id: string): Promise<Tag | null> {
    const result = await db.select().from(tags).where(eq(tags.id, id))

    return result[0] ?? null
  }

  async findMany(query: GetTagsQuery): Promise<TagWithUsageCount[]> {
    // 基本のクエリ条件を構築
    const conditions = []

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

    // 各タグの使用数を取得
    const result: TagWithUsageCount[] = []
    for (const tag of tagsResult) {
      const usageCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(itemTags)
        .where(eq(itemTags.tagId, tag.id))

      result.push({
        ...tag,
        usageCount: Number(usageCountResult[0]?.count ?? 0),
      })
    }

    return result
  }

  async update(input: UpdateTagInput): Promise<Tag> {
    const updateData: Partial<typeof tags.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (input.name !== undefined) {
      updateData.name = input.name
    }

    const [updated] = await db
      .update(tags)
      .set(updateData)
      .where(eq(tags.id, input.id))
      .returning()

    return updated
  }

  async delete(id: string): Promise<void> {
    // itemTagsはonDelete: cascadeなので自動削除
    await db.delete(tags).where(eq(tags.id, id))
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
