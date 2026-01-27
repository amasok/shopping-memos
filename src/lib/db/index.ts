import Dexie, { type EntityTable } from "dexie"

// エンティティ型定義
export interface Tag {
  id: string
  name: string
  createdAt: Date
  updatedAt: Date
}

export interface ShoppingItem {
  id: string
  name: string
  quantity: number
  tagIds: string[]
  createdAt: Date
  updatedAt: Date
}

export interface ShoppingList {
  id: string
  name: string
  status: "in_progress" | "completed"
  createdAt: Date
  completedAt?: Date
}

export interface ListItem {
  id: string
  listId: string
  name: string
  quantity: number
  checked: boolean
  createdAt: Date
}

export interface PurchaseHistory {
  id: string
  listId: string
  location?: string
  items: { name: string; quantity: number }[]
  purchasedAt: Date
}

// Dexie データベースクラス
class ShoppingMemosDB extends Dexie {
  tags!: EntityTable<Tag, "id">
  items!: EntityTable<ShoppingItem, "id">
  lists!: EntityTable<ShoppingList, "id">
  listItems!: EntityTable<ListItem, "id">
  history!: EntityTable<PurchaseHistory, "id">

  constructor() {
    super("ShoppingMemosDB")

    this.version(1).stores({
      tags: "id, name, createdAt",
      items: "id, name, createdAt, *tagIds",
      lists: "id, status, createdAt",
      listItems: "id, listId, checked",
      history: "id, listId, purchasedAt",
    })
  }
}

// シングルトンインスタンス
export const db = new ShoppingMemosDB()

// ID生成ユーティリティ
export function generateId(): string {
  return crypto.randomUUID()
}
