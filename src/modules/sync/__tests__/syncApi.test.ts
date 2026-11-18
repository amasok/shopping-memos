import { describe, it, expect, beforeEach } from "vitest"
import {
  syncPushInputSchema,
  syncPullInputSchema,
  syncMergeInputSchema,
} from "@/shared/schemas/sync"

describe("Sync API スキーマテスト", () => {
  describe("syncPushInputSchema", () => {
    it("エンティティごとの操作（create / update / delete）を受け入れる（#62 O4）", () => {
      const op = (entity: "item" | "tag" | "list" | "listItem", type: "create" | "update" | "delete") => ({
        opId: crypto.randomUUID(),
        entity,
        entityId: crypto.randomUUID(),
        type,
        patch: type === "delete" ? undefined : { name: "x" },
        clientTime: new Date().toISOString(),
      })
      const result = syncPushInputSchema.parse({
        protocolVersion: 1,
        operations: [op("item", "create"), op("tag", "update"), op("list", "delete"), op("listItem", "update")],
      })
      expect(result.operations.map((o) => [o.entity, o.type])).toEqual([
        ["item", "create"],
        ["tag", "update"],
        ["list", "delete"],
        ["listItem", "update"],
      ])
    })
  })

  describe("syncPullInputSchema（#62 O5）", () => {
    it("カーソルと protocolVersion を受け入れ、カーソルは省略できる", () => {
      expect(syncPullInputSchema.parse({ protocolVersion: 1, cursor: "abc" }).cursor).toBe("abc")
      expect(syncPullInputSchema.parse({ protocolVersion: 1 }).cursor).toBeUndefined()
    })
  })

  describe("syncMergeInputSchema", () => {
    it("ローカルデータをマージ入力として受け入れる", () => {
      const input = {
        data: {
          items: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "アイテム1",
              quantity: 1,
              tagIds: [],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "アイテム2",
              quantity: 2,
              tagIds: [],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          tags: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "タグ1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
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
