import { db } from "@/infrastructure/db/drizzle/client"
import { shoppingLists, listItems } from "@/infrastructure/db/drizzle/schema"
import { inArray } from "drizzle-orm"
import { eq } from "drizzle-orm"
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

      // 1. リストを購入完了に更新（purchasedAtを設定）
      await tx
        .update(shoppingLists)
        .set({
          status: ListStatus.COMPLETED,
          completedAt: now,
          purchasedAt: now,
          location: location ?? null,
        })
        .where(eq(shoppingLists.id, listId))

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

      // 3. 未チェックアイテムをlist_itemsから削除（履歴には購入済みのみ残す）
      // カタログアイテムはリスト追加時に保持されているため、自動的に「買いたいもの」に戻る
      if (uncheckedItemIds.length > 0) {
        await tx
          .delete(listItems)
          .where(inArray(listItems.id, uncheckedItemIds))
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
