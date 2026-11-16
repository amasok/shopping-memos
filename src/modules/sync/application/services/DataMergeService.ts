import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/infrastructure/db/drizzle/client"
import { describeDbError, formatDbErrorKind, type DbErrorKind } from "@/infrastructure/db/errors"
import { areTagsInScope } from "@/modules/catalog/application/services/ownership"
import { canAccessScope, type DbExecutor } from "@/infrastructure/db/ownership"
import { findEntityScope, findListScope } from "@/modules/sync/infrastructure/entityAccess"
import type { SyncEntity } from "@/modules/sync/domain/entities/SyncOperation"
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
  /**
   * レコード単位で取り込めなかった件数（#116）。
   * タグの関連付けだけのスキップや、同じユーザーが取り込み済みのレコード（再試行の重複）は数えない
   */
  failedCount: number
  /** 同じユーザーが前回までに取り込み済みだったレコードの件数（分割送信の再試行で送り直した分） */
  alreadyMergedCount: number
  /** トランザクション全体が失敗した（何も取り込まれていない） */
  fatal: boolean
  /**
   * ID を付け替えたタグ（ゲストのタグの ID が、ほかのユーザーのタグと重なった場合）。
   * クライアントは、後から送るアイテム・リストアイテムの tagIds をこれで付け替える
   */
  idMappings: Array<{ entity: "tag"; localId: string; serverId: string }>
  errors: string[]
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type SavepointResult = { ok: true } | { ok: false; error: DbErrorKind }

/**
 * 1 件分の書き込みを SAVEPOINT で囲んで実行する。
 * PostgreSQL では、トランザクション内で 1 文が失敗すると、以降の文がすべて
 * "current transaction is aborted" で失敗する。SAVEPOINT 単位で囲めば、失敗した分だけが
 * ロールバックされ、ほかのデータのマージを続けられる。
 * 失敗したときは、ログに残してよいエラーの種類（PG の code・制約名・テーブル名）を返す。
 * ログは、取り込み済みかどうかを判定した後で、呼び出し側が出す
 */
async function inSavepoint(tx: Tx, fn: (sp: Tx) => Promise<void>): Promise<SavepointResult> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp as unknown as Tx)
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeDbError(error) }
  }
}

/** 原因の調査用のログ。データの中身や値（detail・params）は出さず、対象とエラーの種類だけを記録する */
function logMergeFailure(label: string, error: DbErrorKind) {
  console.error(`[DataMerge] ${label} のマージに失敗 (${formatDbErrorKind(error)})`)
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
    const idMappings: MergeResult["idMappings"] = []
    // ゲストのタグの ID → サーバーで使う ID（付け替えたものだけ）
    const tagIdMap = new Map<string, string>()
    const resolveTagId = (id: string) => tagIdMap.get(id) ?? id
    let failedCount = 0
    let alreadyMergedCount = 0
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

    /**
     * INSERT に失敗したレコードが、同じユーザーが前回までに取り込んだもの（同じ ID・個人のデータ）か。
     * 分割して送った途中で失敗し、再試行で送り直した分を、失敗として数えないために使う（#116）
     */
    const isAlreadyMerged = async (
      executor: DbExecutor,
      entity: SyncEntity,
      id: string
    ): Promise<boolean> => {
      try {
        const scope = await findEntityScope(executor, entity, id)
        return scope !== null && scope.userId === userId && (scope.groupId ?? undefined) === groupId
      } catch {
        return false
      }
    }

    /** INSERT に失敗したレコードを、取り込み済みか失敗かに振り分ける（失敗のときだけログに残す） */
    const handleInsertFailure = async (
      executor: DbExecutor,
      entity: SyncEntity,
      id: string,
      message: string,
      error: DbErrorKind
    ) => {
      if (await isAlreadyMerged(executor, entity, id)) {
        alreadyMergedCount++
        return
      }
      logMergeFailure(`${entity}:${id}`, error)
      failedCount++
      errors.push(message)
    }

    /** INSERT 以外の理由でレコードを取り込めなかった */
    const recordFailure = (message: string) => {
      failedCount++
      errors.push(message)
    }

    /** タグを 1 件 INSERT する（同期ログも記録する） */
    const insertTag = (tx: Tx, tag: LocalTag, id: string) =>
      inSavepoint(tx, async (sp) => {
        await sp.insert(tags).values({
          id,
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
          entityId: id,
          operation: "create",
          payload: JSON.stringify({ ...tag, id, groupId }),
          createdAt: now,
        })
      })

    /** このユーザーの、同じ名前の個人タグ（またはマージ先グループのタグ）の ID */
    const findOwnTagIdByName = async (tx: Tx, name: string): Promise<string | undefined> => {
      const [existing] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(
          and(
            eq(tags.userId, userId),
            groupId ? eq(tags.groupId, groupId) : isNull(tags.groupId),
            eq(tags.name, name)
          )
        )
        .limit(1)
      return existing?.id
    }

    /** ゲストのタグを、サーバーの別の ID のタグとして扱う（アイテム・リストアイテムの参照も付け替える） */
    const mapTag = (localId: string, serverId: string) => {
      tagIdMap.set(localId, serverId)
      mergedTagIds.add(serverId)
      idMappings.push({ entity: "tag", localId, serverId })
    }

    /**
     * ゲストのタグの ID が、ほかのユーザー（またはグループ）のタグと重なったときは、新しい ID で作る。
     * 同じブラウザで別のアカウントが先に取り込んだ場合に起きる（ゲストのデータが IndexedDB に残っていたため）
     */
    const createTagWithNewId = async (tx: Tx, tag: LocalTag): Promise<boolean> => {
      const newId = crypto.randomUUID()
      const created = await insertTag(tx, tag, newId)
      if (!created.ok) {
        logMergeFailure(`tag:${tag.id}（新しい ID での作成）`, created.error)
        return false
      }
      mergedCounts.tags++
      mapTag(tag.id, newId)
      return true
    }

    // トランザクションでまとめて実行
    try {
      await db.transaction(async (tx) => {
        // 1. タグをマージ（アイテムより先に）
        for (const tag of data.tags) {
          // 同じ名前の自分のタグがあれば、新しく作らずにそれにまとめる。
          // ゲストに戻るたびに初期タグ（食品など）が新しい ID で作られるので、ログインのたびに二重にならないようにする
          const sameNameId = await findOwnTagIdByName(tx, tag.name)
          if (sameNameId === tag.id) {
            // 同じユーザーが取り込み済み（分割送信の再試行など）
            alreadyMergedCount++
            continue
          }
          if (sameNameId) {
            mapTag(tag.id, sameNameId)
            continue
          }

          const result = await insertTag(tx, tag, tag.id)
          if (result.ok) {
            // ロールバックされた場合に残らないよう、成功してから記録する
            mergedTagIds.add(tag.id)
            mergedCounts.tags++
            continue
          }
          // 同じユーザーが取り込み済み（分割送信の再試行など）なら、失敗に数えない
          if (await isAlreadyMerged(tx, "tag", tag.id)) {
            alreadyMergedCount++
            continue
          }
          // ID がほかのユーザーのタグと重なった（主キーの重複で、その ID の行がある）なら、付け替える
          const isForeignId =
            result.error.code === "23505" && (await findEntityScope(tx, "tag", tag.id).catch(() => null)) !== null
          if (isForeignId && (await createTagWithNewId(tx, tag))) continue

          await handleInsertFailure(tx, "tag", tag.id, `タグ "${tag.name}" のマージに失敗`, result.error)
        }

        // 2. アイテムをマージ
        for (const item of data.items) {
          // ID を付け替えたタグを参照していれば、付け替え後の ID にする
          const itemTagIds = item.tagIds.map(resolveTagId)
          const result = await inSavepoint(tx, async (sp) => {
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
            for (const tagId of itemTagIds) {
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
              const linked = await inSavepoint(sp, async (inner) => {
                await inner.insert(itemTags).values({
                  itemId: item.id,
                  tagId,
                })
              })
              if (!linked.ok) logMergeFailure(`itemTag:${item.id}:${tagId}`, linked.error)
            }

            await sp.insert(syncOperations).values({
              id: crypto.randomUUID(),
              userId,
              entity: "item",
              entityId: item.id,
              operation: "create",
              payload: JSON.stringify({ ...item, tagIds: itemTagIds, groupId }),
              createdAt: now,
            })
          })
          if (result.ok) {
            mergedCounts.items++
          } else {
            await handleInsertFailure(tx, "item", item.id, `アイテム "${item.name}" のマージに失敗`, result.error)
          }
        }

        // 3. リストをマージ
        for (const list of data.lists) {
          const result = await inSavepoint(tx, async (sp) => {
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
          if (result.ok) {
            mergedListIds.add(list.id)
            mergedCounts.lists++
          } else {
            await handleInsertFailure(tx, "list", list.id, `リスト "${list.name}" のマージに失敗`, result.error)
          }
        }

        // 4. リストアイテムをマージ
        for (const listItem of data.listItems) {
          if (!(await canWriteList(tx, listItem.listId))) {
            recordFailure(`リストアイテム "${listItem.name}" のマージに失敗（リストにアクセスできません）`)
            continue
          }
          const listItemTagIds = listItem.tagIds.map(resolveTagId)
          const result = await inSavepoint(tx, async (sp) => {
            await sp.insert(listItems).values({
              id: listItem.id,
              listId: listItem.listId,
              name: listItem.name,
              quantity: listItem.quantity,
              memo: listItem.memo ?? null,
              tagIds: listItemTagIds,
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
              payload: JSON.stringify({ ...listItem, tagIds: listItemTagIds, groupId }),
              createdAt: now,
            })
          })
          if (result.ok) {
            mergedCounts.listItems++
          } else {
            await handleInsertFailure(
              tx,
              "listItem",
              listItem.id,
              `リストアイテム "${listItem.name}" のマージに失敗`,
              result.error
            )
          }
        }

        // 5. 履歴をマージ（リストのpurchasedAtを更新）
        for (const history of data.history) {
          if (!(await canWriteList(tx, history.listId))) {
            recordFailure(`履歴のマージに失敗（リストにアクセスできません）`)
            continue
          }
          let notFound = false
          const result = await inSavepoint(tx, async (sp) => {
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
          // 履歴は UPDATE なので、送り直しても同じ値で上書きされるだけ（重複にならない）
          if (notFound) {
            recordFailure(`履歴のマージに失敗（リストにアクセスできません）`)
          } else if (result.ok) {
            mergedCounts.history++
          } else {
            logMergeFailure(`history:${history.id}`, result.error)
            recordFailure(`履歴のマージに失敗`)
          }
        }
      })

      return {
        success: errors.length === 0,
        mergedCounts,
        failedCount,
        alreadyMergedCount,
        fatal: false,
        idMappings,
        errors,
      }
    } catch (error) {
      // トランザクションごとロールバックされ、何も取り込まれていない
      return {
        success: false,
        mergedCounts: { items: 0, tags: 0, lists: 0, listItems: 0, history: 0 },
        failedCount: 0,
        alreadyMergedCount: 0,
        fatal: true,
        idMappings: [],
        errors: [`マージ処理に失敗しました: ${error}`],
      }
    }
  }
}

export const dataMergeService = new DataMergeService()
