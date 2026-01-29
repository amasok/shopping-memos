import { db } from "@/infrastructure/db/drizzle/client"
import {
  items,
  tags,
  itemTags,
  shoppingLists,
  listItems,
  purchaseHistory,
  syncOperations,
} from "@/infrastructure/db/drizzle/schema"
import { groupRepository } from "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository"

interface LocalItem {
  id: string
  name: string
  quantity: number
  memo?: string | null
  tagIds: string[]
  purchasedAt?: Date | null
  createdAt: Date
}

interface LocalTag {
  id: string
  name: string
  createdAt: Date
}

interface LocalList {
  id: string
  name: string
  status: "in_progress" | "completed"
  createdAt: Date
  completedAt?: Date | null
}

interface LocalListItem {
  id: string
  listId: string
  name: string
  quantity: number
  memo?: string | null
  tagIds: string[]
  checked: boolean
  createdAt: Date
}

interface LocalHistory {
  id: string
  listId: string
  location?: string | null
  itemIds: string[]
  purchasedAt: Date
}

export interface MergeData {
  items: LocalItem[]
  tags: LocalTag[]
  lists: LocalList[]
  listItems: LocalListItem[]
  history: LocalHistory[]
}

export interface MergeResult {
  success: boolean
  mergedCounts: {
    items: number
    tags: number
    lists: number
    listItems: number
    history: number
  }
  errors: string[]
}

/**
 * ローカルデータをサーバーにマージするサービス
 * ログイン時に IndexedDB のデータを PostgreSQL に移行
 */
export class DataMergeService {
  /**
   * ローカルデータをサーバーにマージ
   * @param userId ログインユーザーID
   * @param data ローカルデータ
   * @param targetGroupId マージ先のグループID（省略時はユーザーのデフォルトグループ）
   */
  async merge(
    userId: string,
    data: MergeData,
    targetGroupId?: string
  ): Promise<MergeResult> {
    const errors: string[] = []
    const mergedCounts = {
      items: 0,
      tags: 0,
      lists: 0,
      listItems: 0,
      history: 0,
    }

    // マージ先グループを決定
    let groupId = targetGroupId
    if (!groupId) {
      const userGroups = await groupRepository.findByUserId(userId)
      if (userGroups.length === 0) {
        // グループがない場合は個人用として作成
        const personalGroup = await groupRepository.createWithOwner({
          id: crypto.randomUUID(),
          name: "個人",
          ownerId: userId,
        })
        groupId = personalGroup.id
      } else {
        groupId = userGroups[0].id
      }
    }

    const now = new Date()

    // トランザクションでまとめて実行
    try {
      await db.transaction(async (tx) => {
        // 1. タグをマージ（アイテムより先に）
        for (const tag of data.tags) {
          try {
            await tx.insert(tags).values({
              id: tag.id,
              name: tag.name,
              groupId,
              createdAt: tag.createdAt,
              updatedAt: now,
            })
            mergedCounts.tags++

            // 同期ログを記録
            await tx.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "tag",
              entityId: tag.id,
              operation: "create",
              payload: JSON.stringify({ ...tag, groupId }),
              createdAt: now,
            })
          } catch {
            // 重複の場合はスキップ
            errors.push(`タグ "${tag.name}" のマージに失敗`)
          }
        }

        // 2. アイテムをマージ
        for (const item of data.items) {
          try {
            await tx.insert(items).values({
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              memo: item.memo ?? null,
              groupId,
              purchasedAt: item.purchasedAt ?? null,
              createdAt: item.createdAt,
              updatedAt: now,
            })

            // タグの関連を中間テーブルに挿入
            for (const tagId of item.tagIds) {
              try {
                await tx.insert(itemTags).values({
                  itemId: item.id,
                  tagId,
                })
              } catch {
                // タグが存在しない場合などはスキップ
              }
            }

            mergedCounts.items++

            await tx.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "item",
              entityId: item.id,
              operation: "create",
              payload: JSON.stringify({ ...item, groupId }),
              createdAt: now,
            })
          } catch {
            errors.push(`アイテム "${item.name}" のマージに失敗`)
          }
        }

        // 3. リストをマージ
        for (const list of data.lists) {
          try {
            await tx.insert(shoppingLists).values({
              id: list.id,
              name: list.name,
              status: list.status,
              groupId,
              createdAt: list.createdAt,
              completedAt: list.completedAt ?? null,
            })
            mergedCounts.lists++

            await tx.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "list",
              entityId: list.id,
              operation: "create",
              payload: JSON.stringify({ ...list, groupId }),
              createdAt: now,
            })
          } catch {
            errors.push(`リスト "${list.name}" のマージに失敗`)
          }
        }

        // 4. リストアイテムをマージ
        for (const listItem of data.listItems) {
          try {
            await tx.insert(listItems).values({
              id: listItem.id,
              listId: listItem.listId,
              name: listItem.name,
              quantity: listItem.quantity,
              memo: listItem.memo ?? null,
              tagIds: listItem.tagIds,
              groupId,
              checked: listItem.checked,
              createdAt: listItem.createdAt,
            })
            mergedCounts.listItems++

            await tx.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "listItem",
              entityId: listItem.id,
              operation: "create",
              payload: JSON.stringify({ ...listItem, groupId }),
              createdAt: now,
            })
          } catch {
            errors.push(`リストアイテム "${listItem.name}" のマージに失敗`)
          }
        }

        // 5. 履歴をマージ
        for (const history of data.history) {
          try {
            await tx.insert(purchaseHistory).values({
              id: history.id,
              listId: history.listId,
              location: history.location ?? null,
              itemIds: history.itemIds,
              groupId,
              purchasedAt: history.purchasedAt,
            })
            mergedCounts.history++

            await tx.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "history",
              entityId: history.id,
              operation: "create",
              payload: JSON.stringify({ ...history, groupId }),
              createdAt: now,
            })
          } catch {
            errors.push(`履歴のマージに失敗`)
          }
        }
      })

      return {
        success: errors.length === 0,
        mergedCounts,
        errors,
      }
    } catch (error) {
      return {
        success: false,
        mergedCounts,
        errors: [`マージ処理に失敗しました: ${error}`],
      }
    }
  }
}

export const dataMergeService = new DataMergeService()
