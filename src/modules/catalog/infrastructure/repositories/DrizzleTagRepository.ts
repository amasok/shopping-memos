import { eq, and, sql } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { tags, itemTags, groupMembers } from "@/infrastructure/db/drizzle/schema"
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
    if (query.groupId) {
      conditions.push(eq(tags.groupId, query.groupId))
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

    // グループなしのタグは誰でもアクセス可能（ゲストモード）
    if (!tag.groupId) {
      return true
    }

    // グループメンバーか確認
    const membership = await db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, tag.groupId),
          eq(groupMembers.userId, userId)
        )
      )

    return membership.length > 0
  }
}

// シングルトンインスタンス
export const tagRepository = new DrizzleTagRepository()
