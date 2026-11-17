import type {
  ShoppingList,
  ShoppingListWithItems,
  CreateShoppingListInput,
  UpdateShoppingListInput,
  GetShoppingListsQuery,
  GetPurchaseHistoryQuery,
} from "../entities/ShoppingList"
import type { ListItem, CreateListItemInput, UpdateListItemInput } from "../entities/ListItem"

/**
 * 買い物リストリポジトリインターフェース
 */
export interface ShoppingListRepository {
  // === リスト操作 ===

  /**
   * 買い物リストを作成
   */
  create(input: CreateShoppingListInput): Promise<ShoppingList>

  /**
   * 買い物リストをIDで取得
   */
  findById(id: string): Promise<ShoppingListWithItems | null>

  /**
   * 買い物リスト一覧を取得
   */
  findMany(query: GetShoppingListsQuery): Promise<ShoppingListWithItems[]>

  /**
   * 買い物リストを更新
   */
  update(input: UpdateShoppingListInput, actorUserId: string): Promise<ShoppingList>

  /**
   * 買い物リストを削除
   */
  delete(id: string, actorUserId: string): Promise<void>

  // === リストアイテム操作 ===

  /**
   * リストにアイテムを追加
   */
  addItem(input: CreateListItemInput): Promise<ListItem>

  /**
   * リストアイテムを更新（チェック状態変更）
   */
  updateItem(input: UpdateListItemInput, actorUserId: string): Promise<ListItem>

  /**
   * リストアイテムを削除
   */
  removeItem(id: string, actorUserId: string): Promise<void>

  /**
   * リストアイテムをIDで取得
   */
  findItemById(id: string): Promise<ListItem | null>

  // === アクセス制御 ===

  /**
   * ユーザーがリストにアクセスできるか確認
   */
  canAccess(listId: string, userId: string): Promise<boolean>

  /**
   * ユーザーがリストアイテムにアクセスできるか確認
   */
  canAccessItem(itemId: string, userId: string): Promise<boolean>

  // === 購入履歴操作 ===

  /**
   * 購入履歴一覧を取得（purchasedAtが入っているリスト）
   */
  findPurchaseHistory(query: GetPurchaseHistoryQuery): Promise<ShoppingListWithItems[]>

  /**
   * リストを購入完了にする
   */
  markAsPurchased(id: string, actorUserId: string, location?: string): Promise<ShoppingList>

  /**
   * リストを未購入に戻す
   */
  markAsUnpurchased(id: string, actorUserId: string): Promise<ShoppingList>
}
