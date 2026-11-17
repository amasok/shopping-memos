import { db } from "@/infrastructure/db/drizzle/client"
import { shoppingLists, listItems } from "@/infrastructure/db/drizzle/schema"
import { and, eq, inArray } from "drizzle-orm"
import { accessibleByUser } from "@/infrastructure/db/ownership"
import { notDeleted, softDeleteValues, touchFields } from "@/infrastructure/db/syncColumns"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import type { ShoppingListRepository } from "../../domain/repositories/ShoppingListRepository"
import type { ShoppingListWithItems } from "../../domain/entities/ShoppingList"
import { ListStatus, isInProgress, canTransition } from "../../domain/value-objects/ListStatus"
import { getListScope, markScopedItemsPurchasedByName } from "./catalogItemScope"


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

/**
 * 買い物ドメインサービス
 * 買い物完了フローを管理
 */
export class ShoppingService {
  constructor(
    private shoppingListRepository: ShoppingListRepository
  ) {}

  /**
   * 買い物を完了する
   *
   * ビジネスルール:
   * - チェック済みアイテムのみ購入済みとして記録
   * - チェック済みアイテムはCatalog.ItemのpurchasedAtを設定
   * - 未チェックアイテムは自動的に「買いたいもの」に戻る（カタログアイテムは保持されている）
   * - リストのpurchasedAtを設定（購入履歴として表示）
   */
  async finishShopping(
    listId: string,
    userId: string,
    location?: string
  ): Promise<FinishShoppingResult> {
    // リストを取得
    const list = await this.shoppingListRepository.findById(listId)
    if (!list) {
      throw new ShoppingDomainError("リストが見つかりません")
    }

    // ステータス確認
    if (!isInProgress(list.status)) {
      throw new ShoppingDomainError("このリストは既に完了しています")
    }

    if (!canTransition(list.status, ListStatus.COMPLETED)) {
      throw new ShoppingDomainError("このステータスから完了に遷移できません")
    }

    // チェック済み・未チェックアイテムを抽出
    const checkedItems = list.items.filter((item) => item.checked)
    const uncheckedItems = list.items.filter((item) => !item.checked)
    const checkedItemIds = checkedItems.map((item) => item.id)
    const uncheckedItemIds = uncheckedItems.map((item) => item.id)

    // トランザクションで一括処理
    const result = await db.transaction(async (tx) => {
      const now = new Date()

      // 1. リストを購入完了に更新（purchasedAtを設定）。操作したユーザーが使える、削除されていないリストに限る（#73-1）
      const updatedLists = await tx
        .update(shoppingLists)
        .set({
          status: ListStatus.COMPLETED,
          completedAt: now,
          purchasedAt: now,
          location: location ?? null,
          ...touchFields(shoppingLists, ["status", "completedAt", "purchasedAt", "location"]),
        })
        .where(
          and(
            eq(shoppingLists.id, listId),
            notDeleted(shoppingLists),
            accessibleByUser(shoppingLists, userId)
          )
        )
        .returning({ id: shoppingLists.id })
      if (updatedLists.length === 0) {
        throw new ShoppingDomainError("リストが見つかりません")
      }

      // 2. チェック済みアイテムに対応するCatalog.ItemのpurchasedAtを設定
      // リストと同じスコープ（グループ or 作成者の個人データ）のアイテムに限定する
      const purchasedCatalogItemIds: string[] = []

      if (checkedItems.length > 0) {
        const scope = await getListScope(tx, listId)
        if (scope) {
          for (const checkedItem of checkedItems) {
            const ids = await markScopedItemsPurchasedByName(tx, scope, checkedItem.name, now)
            purchasedCatalogItemIds.push(...ids)
          }
        }
      }

      // 3. 未チェックアイテムをlist_itemsから論理削除（履歴には購入済みのみ残す）
      // カタログアイテムはリスト追加時に保持されているため、自動的に「買いたいもの」に戻る
      if (uncheckedItemIds.length > 0) {
        await tx
          .update(listItems)
          .set(softDeleteValues())
          .where(
            and(
              inArray(listItems.id, uncheckedItemIds),
              eq(listItems.listId, listId),
              notDeleted(listItems)
            )
          )
      }

      return {
        purchasedCatalogItemIds,
        deletedListItemIds: uncheckedItemIds,
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

    // 購入済みアイテム更新
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
      purchasedItemIds: checkedItemIds,
    }
  }
}
