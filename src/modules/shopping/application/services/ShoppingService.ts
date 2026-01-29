import { db } from "@/infrastructure/db/drizzle/client"
import { items, itemTags, shoppingLists } from "@/infrastructure/db/drizzle/schema"
import { eq } from "drizzle-orm"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import type { ShoppingListRepository } from "../../domain/repositories/ShoppingListRepository"
import type { ShoppingListWithItems } from "../../domain/entities/ShoppingList"
import { ListStatus, isInProgress, canTransition } from "../../domain/value-objects/ListStatus"

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
   * - 未チェックアイテムは新しいカタログアイテムとして作成（買いたいものに戻す）
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
      const purchasedCatalogItemIds: string[] = []

      if (checkedItems.length > 0) {
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

      // 3. 未チェックアイテムを「買いたいもの」に戻す（新しいカタログアイテムを作成）
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
      purchasedItemIds: checkedItemIds,
    }
  }
}
