import { and, eq } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { areTagsInScope } from "@/modules/catalog/application/services/ownership"
import {
  canAccessScope,
  findListScope,
  type DbExecutor,
} from "@/modules/sync/infrastructure/entityAccess"
import {
  items,
  tags,
  itemTags,
  shoppingLists,
  listItems,
  syncOperations,
} from "@/infrastructure/db/drizzle/schema"

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
  purchasedAt?: Date | null
  location?: string | null
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * 1 件分の書き込みを SAVEPOINT で囲んで実行する。
 * PostgreSQL では、トランザクション内で 1 文が失敗すると、以降の文がすべて
 * "current transaction is aborted" で失敗する。SAVEPOINT 単位で囲めば、失敗した分だけが
 * ロールバックされ、ほかのデータのマージを続けられる。成功したら true を返す。
 */
async function inSavepoint(tx: Tx, fn: (sp: Tx) => Promise<void>): Promise<boolean> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp as unknown as Tx)
    })
    return true
  } catch {
    return false
  }
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
    // targetGroupIdが指定されていなければ個人アイテムとして扱う（groupId = undefined）
    const groupId = targetGroupId

    const now = new Date()

    // 今回のマージで作成したタグID（アイテムへのタグ付けで常に許可）
    const mergedTagIds = new Set<string>()

    // 今回のマージで作成したリストID（履歴・リストアイテムの紐付け先として常に許可）
    const mergedListIds = new Set<string>()

    // リストへの書き込み可否（今回作成したリスト、または自分がアクセスできる既存リストのみ）
    const canWriteList = async (executor: DbExecutor, listId: string): Promise<boolean> => {
      if (mergedListIds.has(listId)) {
        return true
      }
      const scope = await findListScope(executor, listId)
      return scope !== null && (await canAccessScope(executor, scope, userId))
    }

    // トランザクションでまとめて実行
    try {
      await db.transaction(async (tx) => {
        // 1. タグをマージ（アイテムより先に）
        for (const tag of data.tags) {
          const ok = await inSavepoint(tx, async (sp) => {
            await sp.insert(tags).values({
              id: tag.id,
              name: tag.name,
              userId, // 作成者を設定
              groupId,
              createdAt: tag.createdAt,
              updatedAt: now,
            })

            // 同期ログを記録
            await sp.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "tag",
              entityId: tag.id,
              operation: "create",
              payload: JSON.stringify({ ...tag, groupId }),
              createdAt: now,
            })
          })
          if (ok) {
            // ロールバックされた場合に残らないよう、成功してから記録する
            mergedTagIds.add(tag.id)
            mergedCounts.tags++
          } else {
            // 重複などで失敗した分だけをスキップ
            errors.push(`タグ "${tag.name}" のマージに失敗`)
          }
        }

        // 2. アイテムをマージ
        for (const item of data.items) {
          const ok = await inSavepoint(tx, async (sp) => {
            await sp.insert(items).values({
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              memo: item.memo ?? null,
              userId, // 作成者を設定
              groupId,
              purchasedAt: item.purchasedAt ?? null,
              createdAt: item.createdAt,
              updatedAt: now,
            })

            // タグの関連を中間テーブルに挿入
            // 今回作成したタグ、またはアイテムと同じスコープの既存タグのみ関連付ける
            const allowedTagIds: string[] = []
            for (const tagId of item.tagIds) {
              const allowed = await areTagsInScope([tagId], { userId, groupId }, {
                executor: sp,
                allowedTagIds: mergedTagIds,
              })
              if (allowed) {
                allowedTagIds.push(tagId)
              } else {
                errors.push(`アイテム "${item.name}" のタグの関連付けをスキップ（タグにアクセスできません）`)
              }
            }
            for (const tagId of allowedTagIds) {
              // タグが存在しない場合などはその関連だけスキップ（失敗しても SAVEPOINT 内を汚さない）
              await inSavepoint(sp, async (inner) => {
                await inner.insert(itemTags).values({
                  itemId: item.id,
                  tagId,
                })
              })
            }

            await sp.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "item",
              entityId: item.id,
              operation: "create",
              payload: JSON.stringify({ ...item, groupId }),
              createdAt: now,
            })
          })
          if (ok) {
            mergedCounts.items++
          } else {
            errors.push(`アイテム "${item.name}" のマージに失敗`)
          }
        }

        // 3. リストをマージ
        for (const list of data.lists) {
          const ok = await inSavepoint(tx, async (sp) => {
            await sp.insert(shoppingLists).values({
              id: list.id,
              name: list.name,
              status: list.status,
              userId, // 作成者を設定
              groupId,
              createdAt: list.createdAt,
              completedAt: list.completedAt ?? null,
              purchasedAt: list.purchasedAt ?? null,
              location: list.location ?? null,
            })

            await sp.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "list",
              entityId: list.id,
              operation: "create",
              payload: JSON.stringify({ ...list, groupId }),
              createdAt: now,
            })
          })
          if (ok) {
            mergedListIds.add(list.id)
            mergedCounts.lists++
          } else {
            errors.push(`リスト "${list.name}" のマージに失敗`)
          }
        }

        // 4. リストアイテムをマージ
        for (const listItem of data.listItems) {
          if (!(await canWriteList(tx, listItem.listId))) {
            errors.push(`リストアイテム "${listItem.name}" のマージに失敗（リストにアクセスできません）`)
            continue
          }
          const ok = await inSavepoint(tx, async (sp) => {
            await sp.insert(listItems).values({
              id: listItem.id,
              listId: listItem.listId,
              name: listItem.name,
              quantity: listItem.quantity,
              memo: listItem.memo ?? null,
              tagIds: listItem.tagIds,
              userId, // 作成者を設定
              groupId,
              checked: listItem.checked,
              createdAt: listItem.createdAt,
            })

            await sp.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "listItem",
              entityId: listItem.id,
              operation: "create",
              payload: JSON.stringify({ ...listItem, groupId }),
              createdAt: now,
            })
          })
          if (ok) {
            mergedCounts.listItems++
          } else {
            errors.push(`リストアイテム "${listItem.name}" のマージに失敗`)
          }
        }

        // 5. 履歴をマージ（リストのpurchasedAtを更新）
        for (const history of data.history) {
          if (!(await canWriteList(tx, history.listId))) {
            errors.push(`履歴のマージに失敗（リストにアクセスできません）`)
            continue
          }
          let notFound = false
          const ok = await inSavepoint(tx, async (sp) => {
            // 履歴データをリストのpurchasedAt/locationとして反映
            // 他人のリストを上書きしないよう、今回作成したリスト以外は作成者本人のリストに限定する
            const updated = await sp
              .update(shoppingLists)
              .set({
                purchasedAt: history.purchasedAt,
                location: history.location ?? null,
              })
              .where(
                mergedListIds.has(history.listId)
                  ? eq(shoppingLists.id, history.listId)
                  : and(eq(shoppingLists.id, history.listId), eq(shoppingLists.userId, userId))
              )
              .returning({ id: shoppingLists.id })
            if (updated.length === 0) {
              notFound = true
              return
            }

            await sp.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "list",
              entityId: history.listId,
              operation: "update",
              payload: JSON.stringify({
                id: history.listId,
                purchasedAt: history.purchasedAt,
                location: history.location,
                groupId,
              }),
              createdAt: now,
            })
          })
          if (notFound) {
            errors.push(`履歴のマージに失敗（リストにアクセスできません）`)
          } else if (ok) {
            mergedCounts.history++
          } else {
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
