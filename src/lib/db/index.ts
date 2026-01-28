import Dexie, { type EntityTable } from "dexie"

// エンティティ型定義
export interface Tag {
  id: string
  name: string
  groupId?: string  // グループに紐付け（任意）
  createdAt: Date
  updatedAt: Date
}

export interface ShoppingItem {
  id: string
  name: string
  quantity: number
  memo?: string
  tagIds: string[]
  groupId?: string  // グループに紐付け（任意）
  purchasedAt?: Date  // undefined = 未購入, Date = 購入済み
  createdAt: Date
  updatedAt: Date
}

export interface ShoppingList {
  id: string
  name: string
  status: "in_progress" | "completed"
  groupId?: string  // グループに紐付け（任意）
  createdAt: Date
  completedAt?: Date
}

export interface ListItem {
  id: string
  listId: string
  name: string
  quantity: number
  memo?: string
  tagIds: string[]
  groupId?: string  // グループに紐付け（任意）
  checked: boolean
  createdAt: Date
}

export interface PurchaseHistory {
  id: string
  listId: string
  location?: string
  itemIds: string[]  // 購入したアイテムのID配列
  groupId?: string  // グループに紐付け（任意）
  purchasedAt: Date
}

export interface Group {
  id: string
  name: string
  ownerId: string
  inviteCode?: string
  createdAt: Date
  updatedAt: Date
}

export interface GroupMember {
  id: string
  groupId: string
  userId: string
  userName: string
  userEmail: string
  role: "owner" | "member"
  joinedAt: Date
}

// 同期キュー（バックグラウンド同期用）
export interface SyncQueueItem {
  id: string
  entity: "item" | "tag" | "list" | "listItem" | "history"
  entityId: string
  operation: "create" | "update" | "delete"
  payload: string // JSON文字列
  createdAt: Date
  retryCount: number
}

// Dexie データベースクラス
class ShoppingMemosDB extends Dexie {
  tags!: EntityTable<Tag, "id">
  items!: EntityTable<ShoppingItem, "id">
  lists!: EntityTable<ShoppingList, "id">
  listItems!: EntityTable<ListItem, "id">
  history!: EntityTable<PurchaseHistory, "id">
  groups!: EntityTable<Group, "id">
  groupMembers!: EntityTable<GroupMember, "id">
  syncQueue!: EntityTable<SyncQueueItem, "id">

  constructor() {
    super("ShoppingMemosDB")

    this.version(1).stores({
      tags: "id, name, createdAt",
      items: "id, name, createdAt, *tagIds",
      lists: "id, status, createdAt",
      listItems: "id, listId, checked",
      history: "id, listId, purchasedAt",
    })

    // v2: ListItem に tagIds を追加
    this.version(2).stores({
      tags: "id, name, createdAt",
      items: "id, name, createdAt, *tagIds",
      lists: "id, status, createdAt",
      listItems: "id, listId, checked, *tagIds",
      history: "id, listId, purchasedAt",
    }).upgrade((tx) => {
      // 既存の listItems に tagIds: [] を追加
      return tx.table("listItems").toCollection().modify((item) => {
        if (!item.tagIds) {
          item.tagIds = []
        }
      })
    })

    // v3: ShoppingItem と ListItem に memo を追加
    this.version(3).stores({
      tags: "id, name, createdAt",
      items: "id, name, createdAt, *tagIds",
      lists: "id, status, createdAt",
      listItems: "id, listId, checked, *tagIds",
      history: "id, listId, purchasedAt",
    })
    // memo はオプショナルなのでマイグレーション不要

    // v4: ShoppingItem に purchasedAt を追加、PurchaseHistory.items を itemIds に変更
    this.version(4).stores({
      tags: "id, name, createdAt",
      items: "id, name, createdAt, purchasedAt, *tagIds",
      lists: "id, status, createdAt",
      listItems: "id, listId, checked, *tagIds",
      history: "id, listId, purchasedAt",
    }).upgrade((tx) => {
      // 既存の history.items を itemIds に変換（空配列に）
      // 既存データは名前しかないのでIDへの変換は不可能
      return tx.table("history").toCollection().modify((record) => {
        record.itemIds = []
        delete record.items
      })
    })

    // v5: グループ機能を追加
    this.version(5).stores({
      tags: "id, name, createdAt",
      items: "id, name, createdAt, purchasedAt, *tagIds",
      lists: "id, status, createdAt",
      listItems: "id, listId, checked, *tagIds",
      history: "id, listId, purchasedAt",
      groups: "id, ownerId, inviteCode, createdAt",
      groupMembers: "id, groupId, userId",
    })

    // v6: 各エンティティにグループ紐付けを追加
    this.version(6).stores({
      tags: "id, name, groupId, createdAt",
      items: "id, name, groupId, createdAt, purchasedAt, *tagIds",
      lists: "id, status, groupId, createdAt",
      listItems: "id, listId, groupId, checked, *tagIds",
      history: "id, listId, groupId, purchasedAt",
      groups: "id, ownerId, inviteCode, createdAt",
      groupMembers: "id, groupId, userId",
    })
    // groupId はオプショナルなのでマイグレーション不要（undefined許容）

    // v7: 同期キューを追加（バックグラウンド同期用）
    this.version(7).stores({
      tags: "id, name, groupId, createdAt",
      items: "id, name, groupId, createdAt, purchasedAt, *tagIds",
      lists: "id, status, groupId, createdAt",
      listItems: "id, listId, groupId, checked, *tagIds",
      history: "id, listId, groupId, purchasedAt",
      groups: "id, ownerId, inviteCode, createdAt",
      groupMembers: "id, groupId, userId",
      syncQueue: "id, entity, createdAt, retryCount",
    })
  }
}

// シングルトンインスタンス
export const db = new ShoppingMemosDB()

// ID生成ユーティリティ
export function generateId(): string {
  return crypto.randomUUID()
}
