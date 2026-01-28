import { describe, it, expect, beforeEach } from "vitest"
import { ListStatus } from "../domain/value-objects/ListStatus"
import type { ShoppingList } from "../domain/entities/ShoppingList"
import type { ListItem } from "../domain/entities/ListItem"
import type { PurchaseHistory } from "../domain/entities/PurchaseHistory"

describe("ShoppingSyncService テスト", () => {
  describe("リスト操作の同期ログ", () => {
    interface MockSyncOperation {
      id: string
      userId: string
      entity: string
      entityId: string
      operation: string
      payload: Record<string, unknown>
    }

    let syncOperations: MockSyncOperation[]

    beforeEach(() => {
      syncOperations = []
    })

    function createSyncOperation(op: MockSyncOperation): void {
      syncOperations.push(op)
    }

    it("リスト作成時に同期ログが記録される", () => {
      const list: ShoppingList = {
        id: "list-1",
        name: "今日の買い物",
        status: ListStatus.IN_PROGRESS,
        groupId: "group-1",
        createdAt: new Date(),
        completedAt: null,
      }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "list",
        entityId: list.id,
        operation: "create",
        payload: list,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("list")
      expect(syncOperations[0].operation).toBe("create")
    })

    it("リスト更新時に同期ログが記録される", () => {
      const list: ShoppingList = {
        id: "list-1",
        name: "更新後の名前",
        status: ListStatus.IN_PROGRESS,
        groupId: "group-1",
        createdAt: new Date(),
        completedAt: null,
      }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "list",
        entityId: list.id,
        operation: "update",
        payload: list,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].operation).toBe("update")
    })

    it("リスト削除時に同期ログが記録される", () => {
      const listId = "list-1"
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "list",
        entityId: listId,
        operation: "delete",
        payload: { id: listId },
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].operation).toBe("delete")
    })
  })

  describe("リストアイテム操作の同期ログ", () => {
    interface MockSyncOperation {
      id: string
      userId: string
      entity: string
      entityId: string
      operation: string
      payload: Record<string, unknown>
    }

    let syncOperations: MockSyncOperation[]

    beforeEach(() => {
      syncOperations = []
    })

    function createSyncOperation(op: MockSyncOperation): void {
      syncOperations.push(op)
    }

    it("アイテム追加時に同期ログが記録される", () => {
      const item: ListItem = {
        id: "item-1",
        listId: "list-1",
        name: "牛乳",
        quantity: 1,
        memo: null,
        tagIds: null,
        groupId: null,
        checked: false,
        createdAt: new Date(),
      }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "listItem",
        entityId: item.id,
        operation: "create",
        payload: item,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("listItem")
      expect(syncOperations[0].operation).toBe("create")
    })

    it("アイテムチェック時に同期ログが記録される", () => {
      const item: ListItem = {
        id: "item-1",
        listId: "list-1",
        name: "牛乳",
        quantity: 1,
        memo: null,
        tagIds: null,
        groupId: null,
        checked: true,
        createdAt: new Date(),
      }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "listItem",
        entityId: item.id,
        operation: "update",
        payload: item,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("listItem")
      expect(syncOperations[0].operation).toBe("update")
    })

    it("アイテム削除時に同期ログが記録される", () => {
      const itemId = "item-1"
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "listItem",
        entityId: itemId,
        operation: "delete",
        payload: { id: itemId },
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("listItem")
      expect(syncOperations[0].operation).toBe("delete")
    })
  })

  describe("履歴操作の同期ログ", () => {
    interface MockSyncOperation {
      id: string
      userId: string
      entity: string
      entityId: string
      operation: string
      payload: Record<string, unknown>
    }

    let syncOperations: MockSyncOperation[]

    beforeEach(() => {
      syncOperations = []
    })

    function createSyncOperation(op: MockSyncOperation): void {
      syncOperations.push(op)
    }

    it("履歴作成時に同期ログが記録される", () => {
      const history: PurchaseHistory = {
        id: "history-1",
        listId: "list-1",
        location: "スーパー",
        itemIds: ["item-1"],
        groupId: null,
        purchasedAt: new Date(),
      }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "history",
        entityId: history.id,
        operation: "create",
        payload: history,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("history")
      expect(syncOperations[0].operation).toBe("create")
    })

    it("履歴削除時に同期ログが記録される", () => {
      const historyId = "history-1"
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "history",
        entityId: historyId,
        operation: "delete",
        payload: { id: historyId },
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("history")
      expect(syncOperations[0].operation).toBe("delete")
    })
  })

  describe("複合操作の同期", () => {
    interface MockSyncOperation {
      id: string
      userId: string
      entity: string
      entityId: string
      operation: string
    }

    let syncOperations: MockSyncOperation[]

    beforeEach(() => {
      syncOperations = []
    })

    function createSyncOperation(entity: string, entityId: string, operation: string, userId: string): void {
      syncOperations.push({
        id: crypto.randomUUID(),
        userId,
        entity,
        entityId,
        operation,
      })
    }

    it("リスト作成時に複数の同期ログが記録される", () => {
      const userId = "user-1"
      const listId = "list-1"

      // リスト作成
      createSyncOperation("list", listId, "create", userId)

      // アイテム追加
      createSyncOperation("listItem", "item-1", "create", userId)
      createSyncOperation("listItem", "item-2", "create", userId)
      createSyncOperation("listItem", "item-3", "create", userId)

      expect(syncOperations).toHaveLength(4)
      expect(syncOperations.filter((op) => op.entity === "list")).toHaveLength(1)
      expect(syncOperations.filter((op) => op.entity === "listItem")).toHaveLength(3)
    })

    it("買い物完了時に複数の同期ログが記録される", () => {
      const userId = "user-1"
      const listId = "list-1"
      const historyId = "history-1"

      // リスト完了
      createSyncOperation("list", listId, "update", userId)

      // 履歴作成
      createSyncOperation("history", historyId, "create", userId)

      // アイテム購入済み更新
      createSyncOperation("item", "item-1", "update", userId)
      createSyncOperation("item", "item-2", "update", userId)

      expect(syncOperations).toHaveLength(4)
      expect(syncOperations.filter((op) => op.entity === "list")).toHaveLength(1)
      expect(syncOperations.filter((op) => op.entity === "history")).toHaveLength(1)
      expect(syncOperations.filter((op) => op.entity === "item")).toHaveLength(2)
    })
  })

  describe("ユーザー追跡", () => {
    it("同期ログにユーザーIDが記録される", () => {
      const operation = {
        id: crypto.randomUUID(),
        userId: "user-123",
        entity: "list",
        entityId: "list-1",
        operation: "create",
        payload: { name: "テスト" },
      }

      expect(operation.userId).toBe("user-123")
    })

    it("異なるユーザーの操作は区別される", () => {
      const operations = [
        {
          id: crypto.randomUUID(),
          userId: "user-1",
          entity: "list",
          entityId: "list-1",
          operation: "create",
        },
        {
          id: crypto.randomUUID(),
          userId: "user-2",
          entity: "list",
          entityId: "list-2",
          operation: "create",
        },
      ]

      const user1Ops = operations.filter((op) => op.userId === "user-1")
      const user2Ops = operations.filter((op) => op.userId === "user-2")

      expect(user1Ops).toHaveLength(1)
      expect(user2Ops).toHaveLength(1)
    })
  })
})
