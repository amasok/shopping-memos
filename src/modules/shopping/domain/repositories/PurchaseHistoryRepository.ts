import type {
  PurchaseHistory,
  CreatePurchaseHistoryInput,
  GetPurchaseHistoryQuery,
} from "../entities/PurchaseHistory"

/**
 * 購入履歴リポジトリインターフェース
 */
export interface PurchaseHistoryRepository {
  /**
   * 購入履歴を作成
   */
  create(input: CreatePurchaseHistoryInput): Promise<PurchaseHistory>

  /**
   * 購入履歴をIDで取得
   */
  findById(id: string): Promise<PurchaseHistory | null>

  /**
   * 購入履歴一覧を取得
   */
  findMany(query: GetPurchaseHistoryQuery): Promise<PurchaseHistory[]>

  /**
   * 購入履歴を削除
   */
  delete(id: string): Promise<void>

  /**
   * ユーザーが購入履歴にアクセスできるか確認
   */
  canAccess(historyId: string, userId: string): Promise<boolean>
}
