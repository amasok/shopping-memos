import type { DbExecutor } from "@/infrastructure/db/ownership"
import type {
  Item,
  CreateItemInput,
  UpdateItemInput,
  GetItemsQuery,
  ItemWithTags,
} from "../entities/Item"

/**
 * アイテムリポジトリインターフェース
 */
export interface ItemRepository {
  /**
   * アイテムを作成
   */
  create(input: CreateItemInput): Promise<Item>

  /**
   * アイテムをIDで取得
   */
  findById(id: string): Promise<ItemWithTags | null>

  /**
   * アイテム一覧を取得（フィルタリング可能）
   */
  findMany(query: GetItemsQuery): Promise<ItemWithTags[]>

  /**
   * アイテムを更新
   */
  update(input: UpdateItemInput, actorUserId: string): Promise<Item>

  /**
   * アイテムを削除
   */
  delete(id: string, actorUserId: string, executor?: DbExecutor): Promise<void>

  /**
   * アイテムを購入済みにする
   */
  markAsPurchased(id: string, actorUserId: string): Promise<Item>

  /**
   * アイテムを未購入に戻す
   */
  markAsUnpurchased(id: string, actorUserId: string): Promise<Item>

  /**
   * ユーザーがアイテムにアクセスできるか確認
   * グループメンバーであればアクセス可能
   */
  canAccess(itemId: string, userId: string): Promise<boolean>
}
