/**
 * 購入履歴
 */
export interface PurchaseHistory {
  id: string
  listId: string
  location: string | null
  itemIds: string[] | null
  groupId: string | null
  purchasedAt: Date
}

/**
 * 購入履歴作成入力
 */
export interface CreatePurchaseHistoryInput {
  id: string
  listId: string
  location?: string | null
  itemIds: string[]
  groupId?: string | null
}

/**
 * 購入履歴取得クエリ
 */
export interface GetPurchaseHistoryQuery {
  groupId?: string
  limit?: number
  offset?: number
}
