import { db } from "@/infrastructure/db/drizzle/client"
import type { DbExecutor } from "@/infrastructure/db/ownership"
import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import { deleteCatalogItemsWithList } from "./shoppingCompletion"
import type { ShoppingListRepository } from "../../domain/repositories/ShoppingListRepository"
import type {
  ShoppingList,
  ShoppingListWithItems,
  CreateShoppingListInput,
  UpdateShoppingListInput,
  GetShoppingListsQuery,
  GetPurchaseHistoryQuery,
} from "../../domain/entities/ShoppingList"
import type {
  ListItem,
  CreateListItemInput,
  UpdateListItemInput,
} from "../../domain/entities/ListItem"

/**
 * Shopping同期サービス
 * CRUD操作と同期ログ記録を統合
 */
export class ShoppingSyncService {
  constructor(
    private shoppingListRepository: ShoppingListRepository
  ) {}

  // === リスト操作 ===

  async createList(input: Omit<CreateShoppingListInput, "userId">, userId: string): Promise<ShoppingList> {
    const list = await this.shoppingListRepository.create({ ...input, userId })

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "list",
      entityId: list.id,
      operation: "create",
      payload: { ...list },
    })

    return list
  }

  async updateList(input: UpdateShoppingListInput, userId: string): Promise<ShoppingList> {
    const list = await this.shoppingListRepository.update(input, userId)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "list",
      entityId: list.id,
      operation: "update",
      payload: { ...list },
    })

    return list
  }

  /**
   * リストを削除する（リストの商品もまとめて論理削除される）
   * @param options.deleteCatalogItems true なら、同じトランザクションで、リストの商品と同じ名前・同じスコープの
   *   未購入のカタログの商品も論理削除する（179b）。同期の記録はコミットの後に書く
   */
  async deleteList(id: string, userId: string, options: { deleteCatalogItems?: boolean } = {}): Promise<void> {
    let deletedCatalogItemIds: string[] = []
    if (options.deleteCatalogItems) {
      deletedCatalogItemIds = await db.transaction(async (tx) => {
        const ids = await deleteCatalogItemsWithList(tx, id, userId)
        await this.shoppingListRepository.delete(id, userId, tx)
        return ids
      })
    } else {
      await this.shoppingListRepository.delete(id, userId)
    }

    // 同期ログを記録（コミットの後）
    for (const itemId of deletedCatalogItemIds) {
      await syncRepository.createOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "item",
        entityId: itemId,
        operation: "delete",
        payload: { id: itemId },
      })
    }
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "list",
      entityId: id,
      operation: "delete",
      payload: { id },
    })
  }

  // 読み取り操作は同期ログ不要
  async getList(id: string): Promise<ShoppingListWithItems | null> {
    return this.shoppingListRepository.findById(id)
  }

  async getLists(query: GetShoppingListsQuery): Promise<ShoppingListWithItems[]> {
    return this.shoppingListRepository.findMany(query)
  }

  async canAccessList(listId: string, userId: string): Promise<boolean> {
    return this.shoppingListRepository.canAccess(listId, userId)
  }

  // === リストアイテム操作 ===

  async addItem(input: CreateListItemInput, userId: string): Promise<ListItem> {
    const item = await this.shoppingListRepository.addItem(input)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "listItem",
      entityId: item.id,
      operation: "create",
      payload: { ...item },
    })

    return item
  }

  async updateItem(input: UpdateListItemInput, userId: string): Promise<ListItem> {
    const item = await this.shoppingListRepository.updateItem(input, userId)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "listItem",
      entityId: item.id,
      operation: "update",
      payload: { ...item },
    })

    return item
  }

  async removeItem(id: string, userId: string): Promise<void> {
    await this.shoppingListRepository.removeItem(id, userId)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "listItem",
      entityId: id,
      operation: "delete",
      payload: { id },
    })
  }

  async getItem(id: string): Promise<ListItem | null> {
    return this.shoppingListRepository.findItemById(id)
  }

  async canAccessItem(itemId: string, userId: string): Promise<boolean> {
    return this.shoppingListRepository.canAccessItem(itemId, userId)
  }

  // === 購入履歴操作（purchasedAtが入っているリスト） ===

  async getHistory(query: GetPurchaseHistoryQuery): Promise<ShoppingListWithItems[]> {
    return this.shoppingListRepository.findPurchaseHistory(query)
  }

  async getHistoryById(id: string): Promise<ShoppingListWithItems | null> {
    const list = await this.shoppingListRepository.findById(id)
    // purchasedAtが入っているリストのみ履歴として返す
    if (list && list.purchasedAt) {
      return list
    }
    return null
  }

  /**
   * 履歴を削除する（リスト削除。list_items もまとめて論理削除される）
   * @param deleteCatalogItems 同じトランザクションで行う、カタログのアイテムの削除（削除したアイテムの ID を返す）。
   *   リストの削除が失敗したら、カタログのアイテムの削除も戻す
   * @returns deleteCatalogItems が削除したカタログのアイテムの ID
   */
  async deleteHistory(
    id: string,
    userId: string,
    deleteCatalogItems?: (executor: DbExecutor) => Promise<string[]>
  ): Promise<string[]> {
    const deletedCatalogItemIds = await db.transaction(async (tx) => {
      const ids = deleteCatalogItems ? await deleteCatalogItems(tx) : []
      await this.shoppingListRepository.delete(id, userId, tx)
      return ids
    })

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "list",
      entityId: id,
      operation: "delete",
      payload: { id },
    })

    return deletedCatalogItemIds
  }

  async canAccessHistory(listId: string, userId: string): Promise<boolean> {
    return this.shoppingListRepository.canAccess(listId, userId)
  }
}
