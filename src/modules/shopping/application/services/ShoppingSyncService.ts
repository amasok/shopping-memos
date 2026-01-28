import { syncRepository } from "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository"
import type { ShoppingListRepository } from "../../domain/repositories/ShoppingListRepository"
import type { PurchaseHistoryRepository } from "../../domain/repositories/PurchaseHistoryRepository"
import type {
  ShoppingList,
  ShoppingListWithItems,
  CreateShoppingListInput,
  UpdateShoppingListInput,
  GetShoppingListsQuery,
} from "../../domain/entities/ShoppingList"
import type {
  ListItem,
  CreateListItemInput,
  UpdateListItemInput,
} from "../../domain/entities/ListItem"
import type {
  PurchaseHistory,
  GetPurchaseHistoryQuery,
} from "../../domain/entities/PurchaseHistory"

/**
 * Shopping同期サービス
 * CRUD操作と同期ログ記録を統合
 */
export class ShoppingSyncService {
  constructor(
    private shoppingListRepository: ShoppingListRepository,
    private purchaseHistoryRepository: PurchaseHistoryRepository
  ) {}

  // === リスト操作 ===

  async createList(input: CreateShoppingListInput, userId: string): Promise<ShoppingList> {
    const list = await this.shoppingListRepository.create(input)

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
    const list = await this.shoppingListRepository.update(input)

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

  async deleteList(id: string, userId: string): Promise<void> {
    await this.shoppingListRepository.delete(id)

    // 同期ログを記録
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
    const item = await this.shoppingListRepository.updateItem(input)

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
    await this.shoppingListRepository.removeItem(id)

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

  // === 履歴操作 ===

  async getHistory(query: GetPurchaseHistoryQuery): Promise<PurchaseHistory[]> {
    return this.purchaseHistoryRepository.findMany(query)
  }

  async getHistoryById(id: string): Promise<PurchaseHistory | null> {
    return this.purchaseHistoryRepository.findById(id)
  }

  async deleteHistory(id: string, userId: string): Promise<void> {
    await this.purchaseHistoryRepository.delete(id)

    // 同期ログを記録
    await syncRepository.createOperation({
      id: crypto.randomUUID(),
      userId,
      entity: "history",
      entityId: id,
      operation: "delete",
      payload: { id },
    })
  }

  async canAccessHistory(historyId: string, userId: string): Promise<boolean> {
    return this.purchaseHistoryRepository.canAccess(historyId, userId)
  }
}
