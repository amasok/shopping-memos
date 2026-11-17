import { describe, it, expect } from "vitest"
import {
  getListScope,
  markScopedItemsPurchasedByName,
  markScopedItemsUnpurchasedByName,
  deleteScopedItemsByName,
} from "../application/services/catalogItemScope"
import type { DbExecutor } from "@/infrastructure/db/ownership"
import { createFakeDb } from "./helpers/fakeDb"

const NOW = new Date("2026-01-01T00:00:00Z")
const personal = { userId: "user-A", groupId: null }
const group = { userId: "user-A", groupId: "group-1" }

const itemQueries = (queries: ReturnType<typeof createFakeDb>["queries"]) =>
  queries.filter((q) => q.table === "items")

describe("カタログアイテムのスコープ付き更新・削除 (#64)", () => {
  describe("個人リスト", () => {
    it("購入済み更新は名前とgroupIdなし・作成者の条件で絞り、更新したIDを返す", async () => {
      const { db, queries } = createFakeDb({ itemIdsByName: { 牛乳: ["mine-1"] } })

      const ids = await markScopedItemsPurchasedByName(db as unknown as DbExecutor, personal, "牛乳", NOW)

      expect(ids).toEqual(["mine-1"])
      const [q] = itemQueries(queries)
      expect(q.kind).toBe("update")
      expect(q.set).toMatchObject({ purchasedAt: NOW })
      expect(q.sql).toContain('"items"."name" = $1')
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.sql).toContain('"items"."user_id" = $2')
      expect(q.params).toEqual(["牛乳", "user-A"])
    })

    it("未購入に戻す処理は購入済みのものだけ、かつ作成者のものに限定する", async () => {
      const { db, queries } = createFakeDb({ itemIdsByName: { 牛乳: ["mine-1"] } })

      const ids = await markScopedItemsUnpurchasedByName(db as unknown as DbExecutor, personal, "牛乳")

      expect(ids).toEqual(["mine-1"])
      const [q] = itemQueries(queries)
      expect(q.set).toMatchObject({ purchasedAt: null })
      expect(q.sql).toContain('"items"."purchased_at" is not null')
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.params).toEqual(["牛乳", "user-A"])
    })

    it("削除は名前とgroupIdなし・作成者の条件で絞る（他ユーザーの同名は対象外）", async () => {
      const { db, queries } = createFakeDb({ itemIdsByName: { 牛乳: ["mine-1"] } })

      const ids = await deleteScopedItemsByName(db as unknown as DbExecutor, personal, "牛乳")

      expect(ids).toEqual(["mine-1"])
      const [q] = itemQueries(queries)
      expect(q.kind).toBe("delete")
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.sql).toContain('"items"."user_id" = $2')
      expect(q.params).toEqual(["牛乳", "user-A"])
    })
  })

  describe("グループリスト", () => {
    it("全操作でグループIDのみで絞り、作成者の個人アイテム(groupIdなし)は対象外", async () => {
      const { db, queries } = createFakeDb()
      const exec = db as unknown as DbExecutor

      await markScopedItemsPurchasedByName(exec, group, "牛乳", NOW)
      await markScopedItemsUnpurchasedByName(exec, group, "牛乳")
      await deleteScopedItemsByName(exec, group, "牛乳")

      const qs = itemQueries(queries)
      expect(qs).toHaveLength(3)
      for (const q of qs) {
        expect(q.sql).toContain('"items"."name" = $1')
        expect(q.sql).toContain('"items"."group_id" = $2')
        expect(q.sql).not.toContain("user_id")
        expect(q.sql).not.toContain("is null")
        expect(q.params).toEqual(["牛乳", "group-1"])
      }
    })
  })

  describe("所有者が特定できないリスト", () => {
    it("何にも一致しない条件になり、IDは返らない", async () => {
      const { db, queries } = createFakeDb({ itemIdsByName: { 牛乳: ["other-1"] } })
      const exec = db as unknown as DbExecutor
      const scope = { userId: null, groupId: null }

      await markScopedItemsPurchasedByName(exec, scope, "牛乳", NOW)
      await markScopedItemsUnpurchasedByName(exec, scope, "牛乳")
      await deleteScopedItemsByName(exec, scope, "牛乳")

      for (const q of itemQueries(queries)) {
        expect(q.sql).toContain("false")
        expect(q.sql).not.toContain('"items"."user_id"')
        expect(q.sql).not.toContain('"items"."group_id"')
      }
    })
  })

  describe("getListScope", () => {
    it("リストのuserIdとgroupIdを返す", async () => {
      const { db, queries } = createFakeDb({ listScope: group })

      const scope = await getListScope(db as unknown as DbExecutor, "list-1")

      expect(scope).toEqual(group)
      expect(queries[0].table).toBe("shopping_lists")
      expect(queries[0].params).toEqual(["list-1"])
    })

    it("リストが存在しなければnullを返す", async () => {
      const { db } = createFakeDb()

      expect(await getListScope(db as unknown as DbExecutor, "missing")).toBeNull()
    })
  })
})
