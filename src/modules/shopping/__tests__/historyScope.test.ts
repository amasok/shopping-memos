import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeDb } from "./helpers/fakeDb"

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fakeDb").createFakeDb>,
  syncOps: [] as Array<Record<string, unknown>>,
  canAccess: true,
  history: null as null | { id: string; items: Array<{ name: string }> },
  deleteHistory: vi.fn(),
}))

vi.mock("@/infrastructure/auth/server", () => ({ getAuth: vi.fn() }))
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
    // カタログのアイテムの削除（コールバック）を、記録用の DB で実行する（#62 O3b）
    deleteHistory = async (
      id: string,
      userId: string,
      deleteCatalogItems?: (tx: unknown) => Promise<string[]>
    ) => {
      await state.deleteHistory(id, userId)
      return deleteCatalogItems ? deleteCatalogItems(state.fake.db) : []
    }
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
    state.deleteHistory.mockReset().mockResolvedValue(undefined)
  })

  describe("revertHistory（取り消しは ShoppingService の 1 トランザクション。#179）", () => {
    const PURCHASED = new Date("2026-01-01T00:00:00.000Z")
    const lockedList = { id: LIST_ID, userId: "user-A", groupId: null, status: "completed", purchasedAt: PURCHASED }
    const entries = [
      { id: "li-milk", name: "牛乳", checked: true },
      { id: "li-bread", name: "パン", checked: true },
    ]
    const catalog = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      name: "牛乳",
      userId: "user-A",
      groupId: null,
      purchasedAt: PURCHASED,
      deletedAt: null,
      ...over,
    })
    const writes = () => state.fake.queries.filter((q) => q.kind !== "select")

    it("リストの商品と同じ名前の購入済みの商品を未購入に戻す（個人のリストは作成者の商品だけ）", async () => {
      state.fake = createFakeDb({
        lockedList,
        entries,
        catalogItems: [
          catalog("mine-milk"),
          catalog("mine-bread", { name: "パン" }),
          catalog("mine-unpurchased", { purchasedAt: null }),
          catalog("others-milk", { userId: "user-B" }),
          catalog("group-milk", { groupId: "group-1" }),
        ],
      })

      const res = await caller().revertHistory({ historyId: LIST_ID })

      expect(res.revertedItemIds).toEqual(["mine-milk", "mine-bread"])
      const [update] = itemQueries().filter((q) => q.kind === "update")
      expect(update.set).toMatchObject({ purchasedAt: null })
      expect(update.sql).toContain('"items"."purchased_at" is not null')
      expect(update.sql).toContain('"items"."group_id" is null')
      expect(update.params).toContain("user-A")
      expect(update.params).not.toContain("others-milk")
      expect(update.params).not.toContain("group-milk")
      // 同期ログは、実際に戻したアイテムの分と、リストの分
      expect(state.syncOps.map((o) => [o.entity, o.entityId])).toEqual([
        ["item", "mine-milk"],
        ["item", "mine-bread"],
        ["list", LIST_ID],
      ])
    })

    it("グループのリストでは、グループのアイテムに限定する", async () => {
      state.fake = createFakeDb({
        lockedList: { ...lockedList, groupId: "group-1" },
        entries,
        catalogItems: [catalog("g-milk", { groupId: "group-1" })],
      })

      const res = await caller("user-B").revertHistory({ historyId: LIST_ID })

      expect(res.revertedItemIds).toEqual(["g-milk"])
      for (const q of itemQueries()) {
        expect(q.sql).toContain('"items"."group_id" =')
        expect(q.sql).not.toContain('"items"."user_id"')
        expect(q.params).toContain("group-1")
      }
    })

    it("取り消したリストは進行中に戻り、日時と場所が消える", async () => {
      state.fake = createFakeDb({ lockedList, entries, catalogItems: [] })

      await caller().revertHistory({ historyId: LIST_ID })

      const [listUpdate] = state.fake.queries.filter((q) => q.table === "shopping_lists" && q.kind === "update")
      expect(listUpdate.set).toMatchObject({ status: "in_progress", completedAt: null, purchasedAt: null, location: null })
      expect(listUpdate.sql).toContain('"shopping_lists"."deleted_at" is null')
      expect(listUpdate.sql).toContain('"group_members"."user_id"')
    })

    it("購入履歴でないリストは取り消せない（NOT_FOUND で何も書かない）", async () => {
      state.history = null
      state.fake = createFakeDb({ lockedList: { ...lockedList, status: "in_progress", purchasedAt: null }, entries })

      await expect(caller().revertHistory({ historyId: LIST_ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(writes()).toHaveLength(0)
      expect(state.syncOps).toHaveLength(0)
    })

    it("トランザクションの中で読み直して購入日時がなければ NOT_FOUND で何も書かない", async () => {
      state.fake = createFakeDb({ lockedList: { ...lockedList, status: "in_progress", purchasedAt: null }, entries })

      await expect(caller().revertHistory({ historyId: LIST_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "履歴が見つかりません",
      })
      expect(writes()).toHaveLength(0)
    })

    it("確認の後に使えなくなった履歴は取り消さない（NOT_FOUND で何も書かない）", async () => {
      state.fake = createFakeDb({ lockedList: null, entries, catalogItems: [catalog("mine-milk")] })

      await expect(caller().revertHistory({ historyId: LIST_ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
      const [lock] = state.fake.queries.filter((q) => q.table === "shopping_lists")
      expect(lock.forUpdate).toBe(true)
      expect(lock.sql).toContain('"shopping_lists"."deleted_at" is null')
      expect(lock.sql).toContain('"group_members"."user_id"')
      expect(writes()).toHaveLength(0)
      expect(state.syncOps).toHaveLength(0)
    })

    it("取り消しの途中で失敗したら何も反映しない（すべて 1 つのトランザクションの中で書き、同期の記録も書かない）", async () => {
      state.fake = createFakeDb({
        lockedList,
        entries,
        catalogItems: [catalog("mine-milk")],
        failListUpdate: new Error("list update failed"),
      })

      await expect(caller().revertHistory({ historyId: LIST_ID })).rejects.toBeDefined()
      expect(writes().length).toBeGreaterThan(0)
      expect(writes().every((q) => q.inTransaction)).toBe(true)
      expect(state.syncOps).toHaveLength(0)
    })

    it("権限がなければFORBIDDENでカタログアイテムに触れない", async () => {
      state.canAccess = false
      state.fake = createFakeDb({ lockedList, entries })

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
