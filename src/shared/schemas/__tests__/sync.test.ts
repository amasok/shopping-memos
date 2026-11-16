import { describe, it, expect } from "vitest"
import {
  syncEntitySchema,
  syncOperationTypeSchema,
  syncQueueItemSchema,
  syncPushInputSchema,
  syncConflictSchema,
  syncPullInputSchema,
  syncMergeInputSchema,
  idMappingSchema,
} from "../sync"

describe("同期スキーマ", () => {
  describe("syncEntitySchema", () => {
    it("有効なエンティティタイプを受け入れる", () => {
      expect(syncEntitySchema.parse("item")).toBe("item")
      expect(syncEntitySchema.parse("tag")).toBe("tag")
      expect(syncEntitySchema.parse("list")).toBe("list")
      expect(syncEntitySchema.parse("listItem")).toBe("listItem")
      expect(syncEntitySchema.parse("history")).toBe("history")
    })

    it("無効なエンティティタイプを拒否する", () => {
      expect(() => syncEntitySchema.parse("invalid")).toThrow()
      expect(() => syncEntitySchema.parse("user")).toThrow()
    })
  })

  describe("syncOperationTypeSchema", () => {
    it("有効な操作タイプを受け入れる", () => {
      expect(syncOperationTypeSchema.parse("create")).toBe("create")
      expect(syncOperationTypeSchema.parse("update")).toBe("update")
      expect(syncOperationTypeSchema.parse("delete")).toBe("delete")
    })

    it("無効な操作タイプを拒否する", () => {
      expect(() => syncOperationTypeSchema.parse("invalid")).toThrow()
      expect(() => syncOperationTypeSchema.parse("read")).toThrow()
    })
  })

  describe("syncQueueItemSchema", () => {
    const validItem = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      entity: "item",
      entityId: "123e4567-e89b-12d3-a456-426614174001",
      operation: "create",
      payload: { name: "テスト" },
      createdAt: new Date("2025-01-01"),
      retryCount: 0,
    }

    it("有効なキューアイテムを受け入れる", () => {
      const result = syncQueueItemSchema.parse(validItem)
      expect(result.entity).toBe("item")
      expect(result.operation).toBe("create")
    })

    it("retryCountにデフォルト値0を設定する", () => {
      const itemWithoutRetry = {
        ...validItem,
        retryCount: undefined,
      }
      const result = syncQueueItemSchema.parse(itemWithoutRetry)
      expect(result.retryCount).toBe(0)
    })

    it("不正なUUIDを拒否する", () => {
      const invalidItem = {
        ...validItem,
        id: "invalid-uuid",
      }
      expect(() => syncQueueItemSchema.parse(invalidItem)).toThrow()
    })
  })

  describe("syncPushInputSchema", () => {
    const validInput = {
      operations: [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          entity: "item",
          entityId: "123e4567-e89b-12d3-a456-426614174001",
          operation: "create",
          payload: { name: "テスト" },
          createdAt: new Date("2025-01-01"),
        },
      ],
    }

    it("有効なプッシュ入力を受け入れる", () => {
      const result = syncPushInputSchema.parse(validInput)
      expect(result.operations.length).toBe(1)
    })

    it("空の操作配列を受け入れる", () => {
      const result = syncPushInputSchema.parse({ operations: [] })
      expect(result.operations).toEqual([])
    })
  })

  describe("syncConflictSchema", () => {
    const validConflict = {
      operationId: "123e4567-e89b-12d3-a456-426614174000",
      entity: "item",
      entityId: "123e4567-e89b-12d3-a456-426614174001",
      serverData: { name: "サーバー側の値" },
      serverUpdatedAt: new Date("2025-01-01"),
    }

    it("有効な競合情報を受け入れる", () => {
      const result = syncConflictSchema.parse(validConflict)
      expect(result.entity).toBe("item")
      expect(result.serverData).toEqual({ name: "サーバー側の値" })
    })
  })

  describe("syncPullInputSchema", () => {
    it("since日時を受け入れる", () => {
      const result = syncPullInputSchema.parse({
        since: "2025-01-01T00:00:00Z",
      })
      expect(result.since).toBeInstanceOf(Date)
    })

    it("groupIdsを受け入れる", () => {
      const result = syncPullInputSchema.parse({
        groupIds: ["123e4567-e89b-12d3-a456-426614174000"],
      })
      expect(result.groupIds?.length).toBe(1)
    })

    it("空のオブジェクトを受け入れる", () => {
      const result = syncPullInputSchema.parse({})
      expect(result.since).toBeUndefined()
      expect(result.groupIds).toBeUndefined()
    })
  })

  describe("syncMergeInputSchema", () => {
    const validInput = {
      data: {
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "テスト",
            quantity: 1,
            tagIds: [],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        tags: [],
        lists: [],
        listItems: [],
        history: [],
      },
    }

    it("有効なマージ入力を受け入れる", () => {
      const result = syncMergeInputSchema.parse(validInput)
      expect(result.data.items.length).toBe(1)
    })

    it("すべてのエンティティが必須", () => {
      const invalidInput = {
        data: {
          items: [],
          // tags, lists, listItems, history が不足
        },
      }
      expect(() => syncMergeInputSchema.parse(invalidInput)).toThrow()
    })
  })

  describe("idMappingSchema", () => {
    const validMapping = {
      entity: "item",
      localId: "123e4567-e89b-12d3-a456-426614174000",
      serverId: "123e4567-e89b-12d3-a456-426614174001",
    }

    it("有効なIDマッピングを受け入れる", () => {
      const result = idMappingSchema.parse(validMapping)
      expect(result.entity).toBe("item")
      expect(result.localId).toBe("123e4567-e89b-12d3-a456-426614174000")
      expect(result.serverId).toBe("123e4567-e89b-12d3-a456-426614174001")
    })
  })
})
