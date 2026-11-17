import { db } from "@/infrastructure/db/drizzle/client"
import { RowNotFoundError } from "@/infrastructure/db/errors"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import type { ShoppingListRepository } from "../../domain/repositories/ShoppingListRepository"
import type { ShoppingList, ShoppingListWithItems } from "../../domain/entities/ShoppingList"
import { ListStatus } from "../../domain/value-objects/ListStatus"
import { planFinishShopping } from "../../domain/services/finishShopping"
import { planRevertHistory } from "../../domain/services/revertHistory"
import { applyFinishPlan, applyRevertPlan, lockAccessibleList, readListEntries } from "./shoppingCompletion"

/**
 * 買い物の業務ルールの違反（利用者に見せてよいメッセージ）。
 * DB のエラーなど、それ以外の例外と区別するために使う（#135）
 */
export class ShoppingDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShoppingDomainError"
  }
}

export interface FinishShoppingResult {
  list: ShoppingListWithItems
  purchasedItemIds: string[]
}

export interface RevertHistoryResult {
  list: ShoppingList
  revertedItemIds: string[]
}

/**
 * 買い物ドメインサービス
 * 買い物の完了・履歴の取り消し（規則は domain の planFinishShopping / planRevertHistory。#179）
 */
export class ShoppingService {
  constructor(
    private shoppingListRepository: ShoppingListRepository
  ) {}

  /**
   * 買い物を完了する（specs/shopping「買い物の完了」）
   *
   * 1 つのトランザクションで、リストの行をロックしてからリストの商品を読み、
   * チェック済みの商品と同じ名前・同じスコープのカタログの商品を購入済みに、未チェックの商品を論理削除し、
   * リストを完了にする。リストは操作したユーザーが使える、削除されていないものに限る（#73-1）
   */
  async finishShopping(
    listId: string,
    userId: string,
    location?: string
  ): Promise<FinishShoppingResult> {
    const now = new Date()

    const result = await db.transaction(async (tx) => {
      const list = await lockAccessibleList(tx, listId, userId)
      if (!list) {
        throw new ShoppingDomainError("リストが見つかりません")
      }

      const entries = await readListEntries(tx, listId)
      const plan = planFinishShopping({ status: list.status, entries, at: now, location })
      if (!plan.ok) {
        throw new ShoppingDomainError("このリストは既に完了しています")
      }

      const applied = await applyFinishPlan(tx, list, plan, { actorUserId: userId })
      if (!applied.listUpdated) {
        throw new ShoppingDomainError("リストが見つかりません")
      }
      return {
        purchasedCatalogItemIds: applied.purchasedItemIds,
        checkedEntryIds: entries.filter((e) => e.checked).map((e) => e.id),
      }
    })

    // 同期ログを記録（トランザクション外）
    // リスト購入完了
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "list",
      entityId: listId,
      operation: "update",
      payload: { id: listId, status: ListStatus.COMPLETED, purchasedAt: new Date() },
    })

    // 購入済みアイテム更新（実際に更新したアイテムだけ）
    for (const itemId of result.purchasedCatalogItemIds) {
      await syncRepository.createOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "item",
        entityId: itemId,
        operation: "update",
        payload: { id: itemId, purchasedAt: new Date() },
      })
    }

    // 更新後のリストを取得して返す
    const updatedList = await this.shoppingListRepository.findById(listId)
    if (!updatedList) {
      throw new ShoppingDomainError("更新後のリストが見つかりません")
    }

    return {
      list: updatedList,
      purchasedItemIds: result.checkedEntryIds,
    }
  }

  /**
   * 購入履歴を取り消す（specs/shopping「履歴の取り消し」）
   *
   * 1 つのトランザクションで、リストの行をロックしてから、リストの商品と同じ名前・同じスコープの購入済みの
   * カタログの商品を未購入に戻し、リストを進行中に戻す。途中で失敗したらどれも反映しない
   * @returns 取り消せない（使えない・削除済み・購入履歴でない）ときは null
   */
  async revertHistory(listId: string, userId: string): Promise<RevertHistoryResult | null> {
    const result = await db.transaction(async (tx) => {
      const list = await lockAccessibleList(tx, listId, userId)
      if (!list) return null

      const entries = await readListEntries(tx, listId)
      const plan = planRevertHistory({ purchasedAt: list.purchasedAt, entries })
      if (!plan.ok) return null

      const applied = await applyRevertPlan(tx, list, plan, { actorUserId: userId })
      if (!applied.listRow) {
        // ロック済みなので起きないはずだが、起きたらカタログの更新ごと戻す
        throw new RowNotFoundError("リスト")
      }
      return {
        list: { ...applied.listRow, status: applied.listRow.status as ListStatus },
        revertedItemIds: applied.revertedItemIds,
      }
    })
    if (!result) return null

    // 同期ログを記録（コミットの後）
    for (const catalogItemId of result.revertedItemIds) {
      await syncRepository.createOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "item",
        entityId: catalogItemId,
        operation: "update",
        payload: { id: catalogItemId, purchasedAt: null },
      })
    }
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "list",
      entityId: listId,
      operation: "update",
      payload: { id: listId, purchasedAt: null, status: result.list.status },
    })

    return result
  }
}
