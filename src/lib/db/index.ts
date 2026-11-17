import Dexie, { type EntityTable } from "dexie"
import type { SyncPushEntity, SyncPushOperationType } from "@/shared/schemas/sync"
import { attachVersionHandlers } from "./versionEvents"

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
  purchasedAt?: Date  // 購入日時（購入履歴として表示）
  location?: string   // 購入場所
  updatedAt?: Date    // v10 で追加（それより前のレコードは createdAt で埋める）
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
  updatedAt?: Date  // v10 で追加（それより前のレコードは createdAt で埋める）
}

// PurchaseHistory は廃止
// 購入履歴は ShoppingList.purchasedAt が入っているレコードとして表示

export interface Group {
  id: string
  name: string
  ownerId: string
  inviteCode?: string
  inviteEnabled?: boolean
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

/**
 * 同期キュー（v10。#62 O6）。ログイン中のユーザー DB だけで使う（ゲストでは積まない）
 * - id は opId（sync.push の冪等キー）。seq は積んだ順（送る順）
 * - pending: 未送信 / inflight: 送信中（圧縮の対象から外す）/ failed: サーバーが拒否した
 */
export interface SyncQueueItem {
  id: string
  seq: number
  entity: SyncPushEntity
  entityId: string
  type: SyncPushOperationType
  patch?: Record<string, unknown>
  /** patch の各フィールドの操作時刻（補正済み ISO） */
  fieldTimes?: Record<string, string>
  /** 操作全体の時刻（補正済み ISO） */
  clientTime: string
  retryCount: number
  status: "pending" | "inflight" | "failed"
  lastError?: string
}

/** 同期の状態（v10。ユーザー DB で使う）。値の型は meta.ts の MetaValues */
export interface MetaRecord {
  key: string
  value: unknown
}

/**
 * ログイン時の merge で取り込めなかったゲストのデータ（#144。offline-support.md「4b」）。
 * 通常のテーブルから移すので、ゲストの画面には出ない。そのアカウントの merge でだけ再送する
 */
export interface PendingMergeRecord {
  /** "<userId>:<entity>:<id>" */
  key: string
  entity: "tags" | "items" | "lists" | "listItems"
  /** 取り込めなかった merge のアカウント */
  userId: string
  /** 元のテーブルのレコード（そのまま戻して送れる形） */
  record: Tag | ShoppingItem | ShoppingList | ListItem
  createdAt: Date
}

/** ゲストの DB の名前（ログイン中はユーザーごとの DB。userDb.ts） */
export const GUEST_DB_NAME = "ShoppingMemosDB"

// Dexie データベースクラス
export class ShoppingMemosDB extends Dexie {
  tags!: EntityTable<Tag, "id">
  items!: EntityTable<ShoppingItem, "id">
  lists!: EntityTable<ShoppingList, "id">
  listItems!: EntityTable<ListItem, "id">
  groups!: EntityTable<Group, "id">
  groupMembers!: EntityTable<GroupMember, "id">
  syncQueue!: EntityTable<SyncQueueItem, "id">
  pendingMerge!: EntityTable<PendingMergeRecord, "key">
  meta!: EntityTable<MetaRecord, "key">

  constructor(name: string = GUEST_DB_NAME) {
    super(name)

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

    // v8: 購入履歴をリストに統合（historyテーブル廃止）
    this.version(8).stores({
      tags: "id, name, groupId, createdAt",
      items: "id, name, groupId, createdAt, purchasedAt, *tagIds",
      lists: "id, status, groupId, createdAt, purchasedAt",
      listItems: "id, listId, groupId, checked, *tagIds",
      history: null, // historyテーブルを削除
      groups: "id, ownerId, inviteCode, createdAt",
      groupMembers: "id, groupId, userId",
      syncQueue: "id, entity, createdAt, retryCount",
    }).upgrade(async (tx) => {
      // 既存のhistoryからlists.purchasedAtを設定
      const histories = await tx.table("history").toArray()
      for (const history of histories) {
        await tx.table("lists").update(history.listId, {
          purchasedAt: history.purchasedAt,
          location: history.location,
        })
      }
    })

    // v9: merge で取り込めなかったゲストのデータを、アカウントごとに残す（#144）
    this.version(9).stores({
      tags: "id, name, groupId, createdAt",
      items: "id, name, groupId, createdAt, purchasedAt, *tagIds",
      lists: "id, status, groupId, createdAt, purchasedAt",
      listItems: "id, listId, groupId, checked, *tagIds",
      groups: "id, ownerId, inviteCode, createdAt",
      groupMembers: "id, groupId, userId",
      syncQueue: "id, entity, createdAt, retryCount",
      pendingMerge: "key, userId",
    })

    // v10: 同期エンジン（#62 O6）。キューを新しい形にし（以前の形のキューは使っていなかったので捨てる）、
    // 同期の状態の meta を足し、リストとリストのアイテムに updatedAt を入れる
    this.version(10).stores({
      tags: "id, name, groupId, createdAt",
      items: "id, name, groupId, createdAt, purchasedAt, *tagIds",
      lists: "id, status, groupId, createdAt, purchasedAt",
      listItems: "id, listId, groupId, checked, *tagIds",
      groups: "id, ownerId, inviteCode, createdAt",
      groupMembers: "id, groupId, userId",
      syncQueue: "id, seq, entityId, status",
      pendingMerge: "key, userId",
      meta: "key",
    }).upgrade(async (tx) => {
      await tx.table("syncQueue").clear()
      const fillUpdatedAt = (row: { createdAt?: Date; updatedAt?: Date }) => {
        if (!row.updatedAt) row.updatedAt = row.createdAt ?? new Date()
      }
      await tx.table("lists").toCollection().modify(fillUpdatedAt)
      await tx.table("listItems").toCollection().modify(fillUpdatedAt)
    })

    attachVersionHandlers(this)
  }
}

// シングルトンインスタンス（ゲストの DB）
export const db = new ShoppingMemosDB()

// ID生成ユーティリティ
export function generateId(): string {
  return crypto.randomUUID()
}
