import { eq, and, desc, isNull } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { purchaseHistory, groupMembers } from "@/infrastructure/db/drizzle/schema"
import type { PurchaseHistoryRepository } from "../../domain/repositories/PurchaseHistoryRepository"
import type {
  PurchaseHistory,
  CreatePurchaseHistoryInput,
  GetPurchaseHistoryQuery,
} from "../../domain/entities/PurchaseHistory"

/**
 * Drizzleを使用した購入履歴リポジトリ実装
 */
export class DrizzlePurchaseHistoryRepository implements PurchaseHistoryRepository {
  async create(input: CreatePurchaseHistoryInput): Promise<PurchaseHistory> {
    const now = new Date()

    const [history] = await db
      .insert(purchaseHistory)
      .values({
        id: input.id,
        listId: input.listId,
        location: input.location ?? null,
        itemIds: input.itemIds,
        groupId: input.groupId ?? null,
        purchasedAt: now,
      })
      .returning()

    return history
  }

  async findById(id: string): Promise<PurchaseHistory | null> {
    const result = await db
      .select()
      .from(purchaseHistory)
      .where(eq(purchaseHistory.id, id))

    return result[0] ?? null
  }

  async findMany(query: GetPurchaseHistoryQuery): Promise<PurchaseHistory[]> {
    const conditions = []

    // groupIdフィルタ:
    // - groupIdが指定されている → そのグループの履歴のみ
    // - groupIdがundefined → 個人履歴（groupId IS NULL）のみ
    if (query.groupId !== undefined) {
      conditions.push(eq(purchaseHistory.groupId, query.groupId))
    } else {
      conditions.push(isNull(purchaseHistory.groupId))
    }

    let queryBuilder = db
      .select()
      .from(purchaseHistory)
      .where(and(...conditions))
      .orderBy(desc(purchaseHistory.purchasedAt))

    if (query.limit) {
      queryBuilder = queryBuilder.limit(query.limit) as typeof queryBuilder
    }
    if (query.offset) {
      queryBuilder = queryBuilder.offset(query.offset) as typeof queryBuilder
    }

    return queryBuilder
  }

  async delete(id: string): Promise<void> {
    await db.delete(purchaseHistory).where(eq(purchaseHistory.id, id))
  }

  async canAccess(historyId: string, userId: string): Promise<boolean> {
    const history = await this.findById(historyId)
    if (!history) {
      return false
    }

    // グループなしの履歴は誰でもアクセス可能
    if (!history.groupId) {
      return true
    }

    // グループメンバーか確認
    const membership = await db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, history.groupId),
          eq(groupMembers.userId, userId)
        )
      )

    return membership.length > 0
  }
}

// シングルトンインスタンス
export const purchaseHistoryRepository = new DrizzlePurchaseHistoryRepository()
