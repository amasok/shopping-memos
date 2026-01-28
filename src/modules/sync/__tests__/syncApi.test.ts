import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  syncPushInputSchema,
  syncPullInputSchema,
  syncMergeInputSchema,
} from "@/shared/schemas/sync"

describe("Sync API スキーマテスト", () => {
  describe("syncPushInputSchema", () => {
    it("有効な操作配列を受け入れる", () => {
      const input = {
        operations: [
          {
            id: "123e4567-e89b-12d3-a456-426614174000",
            entity: "item" as const,
            entityId: "123e4567-e89b-12d3-a456-426614174001",
            operation: "create" as const,
            payload: { name: "テストアイテム" },
            createdAt: new Date(),
          },
        ],
      }

      const result = syncPushInputSchema.parse(input)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].entity).toBe("item")
    })

    it("複数の操作を受け入れる", () => {
      const input = {
        operations: [
          {
            id: "123e4567-e89b-12d3-a456-426614174000",
            entity: "item" as const,
            entityId: "123e4567-e89b-12d3-a456-426614174001",
            operation: "create" as const,
            payload: { name: "アイテム1" },
            createdAt: new Date(),
          },
          {
            id: "223e4567-e89b-12d3-a456-426614174000",
            entity: "tag" as const,
            entityId: "223e4567-e89b-12d3-a456-426614174001",
            operation: "update" as const,
            payload: { name: "タグ1" },
            createdAt: new Date(),
          },
          {
            id: "323e4567-e89b-12d3-a456-426614174000",
            entity: "list" as const,
            entityId: "323e4567-e89b-12d3-a456-426614174001",
            operation: "delete" as const,
            payload: {},
            createdAt: new Date(),
          },
        ],
      }

      const result = syncPushInputSchema.parse(input)
      expect(result.operations).toHaveLength(3)
    })
  })

  describe("syncPullInputSchema", () => {
    it("since日時を正しくパースする", () => {
      const input = {
        since: "2025-01-01T00:00:00.000Z",
      }

      const result = syncPullInputSchema.parse(input)
      expect(result.since).toBeInstanceOf(Date)
    })

    it("groupIdsをフィルタリングに使用できる", () => {
      const input = {
        groupIds: [
          "123e4567-e89b-12d3-a456-426614174000",
          "223e4567-e89b-12d3-a456-426614174000",
        ],
      }

      const result = syncPullInputSchema.parse(input)
      expect(result.groupIds).toHaveLength(2)
    })
  })

  describe("syncMergeInputSchema", () => {
    it("ローカルデータをマージ入力として受け入れる", () => {
      const input = {
        data: {
          items: [
            { id: "item-1", name: "アイテム1" },
            { id: "item-2", name: "アイテム2" },
          ],
          tags: [{ id: "tag-1", name: "タグ1" }],
          lists: [],
          listItems: [],
          history: [],
        },
      }

      const result = syncMergeInputSchema.parse(input)
      expect(result.data.items).toHaveLength(2)
      expect(result.data.tags).toHaveLength(1)
    })
  })
})

describe("同期ロジックテスト", () => {
  describe("Last Write Wins 競合解決", () => {
    function resolveConflict(
      localTime: Date,
      serverTime: Date
    ): "local" | "server" {
      return localTime.getTime() > serverTime.getTime() ? "local" : "server"
    }

    it("ローカルが新しい場合はローカルが勝つ", () => {
      const localTime = new Date("2025-01-02")
      const serverTime = new Date("2025-01-01")

      expect(resolveConflict(localTime, serverTime)).toBe("local")
    })

    it("サーバーが新しい場合はサーバーが勝つ", () => {
      const localTime = new Date("2025-01-01")
      const serverTime = new Date("2025-01-02")

      expect(resolveConflict(localTime, serverTime)).toBe("server")
    })

    it("同時刻の場合はサーバーが勝つ", () => {
      const sameTime = new Date("2025-01-01")

      expect(resolveConflict(sameTime, sameTime)).toBe("server")
    })
  })

  describe("同期キュー管理", () => {
    interface MockSyncQueueItem {
      id: string
      entity: string
      entityId: string
      operation: string
      createdAt: Date
      retryCount: number
    }

    let syncQueue: MockSyncQueueItem[]

    beforeEach(() => {
      syncQueue = []
    })

    function addToQueue(item: MockSyncQueueItem): void {
      syncQueue.push(item)
    }

    function clearQueue(ids: string[]): void {
      syncQueue = syncQueue.filter((item) => !ids.includes(item.id))
    }

    it("操作をキューに追加できる", () => {
      addToQueue({
        id: "op-1",
        entity: "item",
        entityId: "item-1",
        operation: "create",
        createdAt: new Date(),
        retryCount: 0,
      })

      expect(syncQueue).toHaveLength(1)
    })

    it("成功した操作をキューから削除できる", () => {
      addToQueue({
        id: "op-1",
        entity: "item",
        entityId: "item-1",
        operation: "create",
        createdAt: new Date(),
        retryCount: 0,
      })
      addToQueue({
        id: "op-2",
        entity: "tag",
        entityId: "tag-1",
        operation: "create",
        createdAt: new Date(),
        retryCount: 0,
      })

      clearQueue(["op-1"])

      expect(syncQueue).toHaveLength(1)
      expect(syncQueue[0].id).toBe("op-2")
    })
  })
})
