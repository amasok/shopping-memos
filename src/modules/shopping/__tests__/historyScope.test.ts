import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeDb } from "./helpers/fakeDb"

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fakeDb").createFakeDb>,
  syncOps: [] as Array<Record<string, unknown>>,
  canAccess: true,
  history: null as null | { id: string; items: Array<{ name: string }> },
  revertHistory: vi.fn(),
  deleteHistory: vi.fn(),
}))

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: new Proxy({}, { get: (_t, prop) => (state.fake.db as never)[prop] }),
}))
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({
  syncRepository: {
    createOperation: async (op: Record<string, unknown>) => {
      state.syncOps.push(op)
    },
  },
}))
vi.mock("@/modules/shopping/application/services/ShoppingSyncService", () => ({
  ShoppingSyncService: class {
    canAccessHistory = async () => state.canAccess
    getHistoryById = async () => state.history
    revertHistory = state.revertHistory
    deleteHistory = state.deleteHistory
  },
}))

import { shoppingRouter } from "@/infrastructure/trpc/routers/shopping"

const LIST_ID = "11111111-1111-4111-8111-111111111111"
const caller = (userId = "user-A") => shoppingRouter.createCaller({ userId })
const itemQueries = () => state.fake.queries.filter((q) => q.table === "items")

describe("履歴の差し戻し・削除のカタログアイテム更新範囲 (#64)", () => {
  beforeEach(() => {
    state.syncOps = []
    state.canAccess = true
    state.history = { id: LIST_ID, items: [{ name: "牛乳" }, { name: "パン" }] }
    state.revertHistory.mockReset().mockResolvedValue({ id: LIST_ID })
    state.deleteHistory.mockReset().mockResolvedValue(undefined)
  })

  describe("revertHistory", () => {
    it("個人リストでは、作成者の購入済みアイテムだけを未購入に戻す", async () => {
      state.fake = createFakeDb({
        listScope: { userId: "user-A", groupId: null },
        itemIdsByName: { 牛乳: ["mine-milk"], パン: ["mine-bread"] },
      })

      const res = await caller().revertHistory({ historyId: LIST_ID })

      expect(res.revertedItemIds).toEqual(["mine-milk", "mine-bread"])
      for (const q of itemQueries()) {
        expect(q.kind).toBe("update")
        expect(q.set).toMatchObject({ purchasedAt: null })
        expect(q.sql).toContain('"items"."purchased_at" is not null')
        expect(q.sql).toContain('"items"."group_id" is null')
        expect(q.params[1]).toBe("user-A")
      }
      expect(state.syncOps.map((o) => o.entityId)).toEqual(["mine-milk", "mine-bread"])
    })

    it("グループリストでは、グループのアイテムに限定する", async () => {
      state.fake = createFakeDb({
        listScope: { userId: "user-A", groupId: "group-1" },
        itemIdsByName: { 牛乳: ["g-milk"] },
      })

      const res = await caller("user-B").revertHistory({ historyId: LIST_ID })

      expect(res.revertedItemIds).toEqual(["g-milk"])
      for (const q of itemQueries()) {
        expect(q.sql).toContain('"items"."group_id" = $2')
        expect(q.sql).not.toContain("user_id")
        expect(q.params[1]).toBe("group-1")
      }
    })

    it("リストが見つからない（スコープ不明）場合はカタログアイテムに触れない", async () => {
      state.fake = createFakeDb({ itemIdsByName: { 牛乳: ["other"] } })

      const res = await caller().revertHistory({ historyId: LIST_ID })

      expect(res.revertedItemIds).toEqual([])
      expect(itemQueries()).toHaveLength(0)
      expect(state.syncOps).toHaveLength(0)
    })

    it("権限がなければFORBIDDENでカタログアイテムに触れない", async () => {
      state.canAccess = false
      state.fake = createFakeDb({ listScope: { userId: "user-A", groupId: null } })

      await expect(caller("user-X").revertHistory({ historyId: LIST_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      })
      expect(state.fake.queries).toHaveLength(0)
    })
  })

  describe("deleteHistory", () => {
    it("個人リストでは、作成者のgroupIdなしアイテムだけを削除し同期ログに残す", async () => {
      state.fake = createFakeDb({
        listScope: { userId: "user-A", groupId: null },
        itemIdsByName: { 牛乳: ["mine-milk"] },
      })

      await caller().deleteHistory({ id: LIST_ID })

      const qs = itemQueries()
      expect(qs).toHaveLength(2)
      for (const q of qs) {
        // カタログアイテムの削除は論理削除（#62 O3b）
        expect(q.kind).toBe("update")
        expect(q.sql).toContain('"items"."group_id" is null')
        expect(q.params[1]).toBe("user-A")
      }
      expect(state.syncOps.map((o) => [o.operation, o.entityId])).toEqual([["delete", "mine-milk"]])
      expect(state.deleteHistory).toHaveBeenCalledWith(LIST_ID, "user-A")
    })

    it("グループリストでは、グループのアイテムだけを削除する", async () => {
      state.fake = createFakeDb({
        listScope: { userId: "user-A", groupId: "group-1" },
        itemIdsByName: { パン: ["g-bread"] },
      })

      await caller("user-B").deleteHistory({ id: LIST_ID })

      for (const q of itemQueries()) {
        expect(q.sql).toContain('"items"."group_id" = $2')
        expect(q.sql).not.toContain("user_id")
        expect(q.params[1]).toBe("group-1")
      }
      expect(state.syncOps.map((o) => o.entityId)).toEqual(["g-bread"])
    })

    it("スコープ不明のリストではカタログアイテムを削除しない", async () => {
      state.fake = createFakeDb({ itemIdsByName: { 牛乳: ["other"] } })

      await caller().deleteHistory({ id: LIST_ID })

      expect(itemQueries()).toHaveLength(0)
      expect(state.syncOps).toHaveLength(0)
    })

    it("権限がなければFORBIDDENで何も削除しない", async () => {
      state.canAccess = false
      state.fake = createFakeDb({ listScope: { userId: "user-A", groupId: null } })

      await expect(caller("user-X").deleteHistory({ id: LIST_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      })
      expect(state.fake.queries).toHaveLength(0)
      expect(state.deleteHistory).not.toHaveBeenCalled()
    })
  })
})
