import { db } from "@/infrastructure/db/drizzle/client"
import { items, itemTags, shoppingLists, purchaseHistory } from "@/infrastructure/db/drizzle/schema"
import { eq, inArray } from "drizzle-orm"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import type { ShoppingListRepository } from "../../domain/repositories/ShoppingListRepository"
import type { PurchaseHistoryRepository } from "../../domain/repositories/PurchaseHistoryRepository"
import type { ShoppingListWithItems } from "../../domain/entities/ShoppingList"
import type { PurchaseHistory } from "../../domain/entities/PurchaseHistory"
import { ListStatus, isInProgress, canTransition } from "../../domain/value-objects/ListStatus"

export interface FinishShoppingResult {
  list: ShoppingListWithItems
  history: PurchaseHistory
  purchasedItemIds: string[]
}

/**
 * 買い物ドメインサービス
 * 買い物完了フローを管理
 */
export class ShoppingService {
  constructor(
    private shoppingListRepository: ShoppingListRepository,
    private purchaseHistoryRepository: PurchaseHistoryRepository
  ) {}

  /**
   * 買い物を完了する
   *
   * ビジネスルール:
   * - チェック済みアイテムのみ履歴に記録
   * - チェック済みアイテムはCatalog.ItemのpurchasedAtを設定
   * - 未チェックアイテムはそのままCatalogに残る
   * - リストのステータスはin_progress → completedの一方通行
   */
  async finishShopping(
    listId: string,
    userId: string,
    location?: string
  ): Promise<FinishShoppingResult> {
    // リストを取得
    const list = await this.shoppingListRepository.findById(listId)
    if (!list) {
      throw new Error("リストが見つかりません")
    }

    // ステータス確認
    if (!isInProgress(list.status)) {
      throw new Error("このリストは既に完了しています")
    }

    if (!canTransition(list.status, ListStatus.COMPLETED)) {
      throw new Error("このステータスから完了に遷移できません")
    }

    // チェック済み・未チェックアイテムを抽出
    const checkedItems = list.items.filter((item) => item.checked)
    const uncheckedItems = list.items.filter((item) => !item.checked)
    const checkedItemIds = checkedItems.map((item) => item.id)

    // トランザクションで一括処理
    const result = await db.transaction(async (tx) => {
      // 1. リストのステータスを完了に更新
      const now = new Date()
      await tx
        .update(shoppingLists)
        .set({
          status: ListStatus.COMPLETED,
          completedAt: now,
        })
        .where(eq(shoppingLists.id, listId))

      // 2. チェック済みアイテムに対応するCatalog.ItemのpurchasedAtを設定
      // リストアイテムの名前からCatalog.Itemを特定（同じグループ内で同名のアイテム）
      const purchasedCatalogItemIds: string[] = []

      if (checkedItems.length > 0) {
        // グループ内の同名アイテムを購入済みにする
        for (const checkedItem of checkedItems) {
          const catalogItems = await tx
            .select({ id: items.id })
            .from(items)
            .where(eq(items.name, checkedItem.name))

          for (const catalogItem of catalogItems) {
            await tx
              .update(items)
              .set({
                purchasedAt: now,
                updatedAt: now,
              })
              .where(eq(items.id, catalogItem.id))

            purchasedCatalogItemIds.push(catalogItem.id)
          }
        }
      }

      // 3. 購入履歴を作成
      const historyId = crypto.randomUUID()
      const [history] = await tx
        .insert(purchaseHistory)
        .values({
          id: historyId,
          listId,
          location: location ?? null,
          itemIds: checkedItemIds,
          groupId: list.groupId,
          purchasedAt: now,
        })
        .returning()

      // 4. 未チェックアイテムを「買いたいもの」に戻す（新しいカタログアイテムを作成）
      const returnedItemIds: string[] = []
      if (uncheckedItems.length > 0) {
        for (const uncheckedItem of uncheckedItems) {
          const newItemId = crypto.randomUUID()
          await tx
            .insert(items)
            .values({
              id: newItemId,
              name: uncheckedItem.name,
              quantity: uncheckedItem.quantity,
              memo: uncheckedItem.memo ?? null,
              userId,
              groupId: uncheckedItem.groupId ?? list.groupId ?? null,
              createdAt: now,
              updatedAt: now,
            })

          // タグを関連付け
          const tagIds = uncheckedItem.tagIds ?? uncheckedItem.tags?.map((t) => t.id) ?? []
          if (tagIds.length > 0) {
            await tx.insert(itemTags).values(
              tagIds.map((tagId) => ({
                itemId: newItemId,
                tagId,
              }))
            )
          }

          returnedItemIds.push(newItemId)
        }
      }

      return {
        purchasedCatalogItemIds,
        returnedItemIds,
        history,
      }
    })

    // 同期ログを記録（トランザクション外）
    // リスト完了
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "list",
      entityId: listId,
      operation: "update",
      payload: { id: listId, status: ListStatus.COMPLETED },
    })

    // 履歴作成
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "history",
      entityId: result.history.id,
      operation: "create",
      payload: { ...result.history },
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

    // 未購入アイテム作成（買いたいものに戻す）
    for (const itemId of result.returnedItemIds) {
      await syncRepository.createOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "item",
        entityId: itemId,
        operation: "create",
        payload: { id: itemId },
      })
    }

    // 更新後のリストを取得して返す
    const updatedList = await this.shoppingListRepository.findById(listId)
    if (!updatedList) {
      throw new Error("更新後のリストが見つかりません")
    }

    return {
      list: updatedList,
      history: result.history,
      purchasedItemIds: checkedItemIds,
    }
  }
}
