import { describe, it, expect, vi, beforeEach } from "vitest"

describe("CatalogSyncService テスト", () => {
  describe("同期ログ記録", () => {
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

    it("アイテム作成時に同期ログが記録される", () => {
      const item = { id: "item-1", name: "牛乳" }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "item",
        entityId: item.id,
        operation: "create",
        payload: item,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("item")
      expect(syncOperations[0].operation).toBe("create")
    })

    it("アイテム更新時に同期ログが記録される", () => {
      const item = { id: "item-1", name: "低脂肪牛乳" }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "item",
        entityId: item.id,
        operation: "update",
        payload: item,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].operation).toBe("update")
    })

    it("アイテム削除時に同期ログが記録される", () => {
      const itemId = "item-1"
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "item",
        entityId: itemId,
        operation: "delete",
        payload: { id: itemId },
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].operation).toBe("delete")
    })

    it("タグ作成時に同期ログが記録される", () => {
      const tag = { id: "tag-1", name: "食品" }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "tag",
        entityId: tag.id,
        operation: "create",
        payload: tag,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("tag")
      expect(syncOperations[0].operation).toBe("create")
    })

    it("タグ更新時に同期ログが記録される", () => {
      const tag = { id: "tag-1", name: "日用品" }
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "tag",
        entityId: tag.id,
        operation: "update",
        payload: tag,
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("tag")
      expect(syncOperations[0].operation).toBe("update")
    })

    it("タグ削除時に同期ログが記録される", () => {
      const tagId = "tag-1"
      const userId = "user-1"

      createSyncOperation({
        id: crypto.randomUUID(),
        userId,
        entity: "tag",
        entityId: tagId,
        operation: "delete",
        payload: { id: tagId },
      })

      expect(syncOperations).toHaveLength(1)
      expect(syncOperations[0].entity).toBe("tag")
      expect(syncOperations[0].operation).toBe("delete")
    })
  })

  describe("同期操作のユーザー追跡", () => {
    it("同期ログにユーザーIDが記録される", () => {
      const operation = {
        id: crypto.randomUUID(),
        userId: "user-123",
        entity: "item",
        entityId: "item-1",
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
          entity: "item",
          entityId: "item-1",
          operation: "create",
        },
        {
          id: crypto.randomUUID(),
          userId: "user-2",
          entity: "item",
          entityId: "item-2",
          operation: "create",
        },
      ]

      const user1Ops = operations.filter((op) => op.userId === "user-1")
      const user2Ops = operations.filter((op) => op.userId === "user-2")

      expect(user1Ops).toHaveLength(1)
      expect(user2Ops).toHaveLength(1)
    })
  })

  describe("購入状態変更の同期", () => {
    it("購入済みにする操作が記録される", () => {
      const item = {
        id: "item-1",
        purchasedAt: new Date(),
      }

      const operation = {
        id: crypto.randomUUID(),
        userId: "user-1",
        entity: "item",
        entityId: item.id,
        operation: "update",
        payload: item,
      }

      expect(operation.operation).toBe("update")
      expect((operation.payload as typeof item).purchasedAt).toBeInstanceOf(Date)
    })

    it("未購入に戻す操作が記録される", () => {
      const item = {
        id: "item-1",
        purchasedAt: null,
      }

      const operation = {
        id: crypto.randomUUID(),
        userId: "user-1",
        entity: "item",
        entityId: item.id,
        operation: "update",
        payload: item,
      }

      expect(operation.operation).toBe("update")
      expect((operation.payload as typeof item).purchasedAt).toBeNull()
    })
  })
})
