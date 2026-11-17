import { describe, it, expect } from "vitest"
import {
  getListScope,
  findScopedCandidatesByNames,
  markItemsPurchased,
  markItemsUnpurchased,
  deleteScopedItemsByName,
} from "../application/services/catalogItemScope"
import type { DbExecutor } from "@/infrastructure/db/ownership"
import { createFakeDb } from "./helpers/fakeDb"

const NOW = new Date("2026-01-01T00:00:00Z")
const personal = { userId: "user-A", groupId: null }
const group = { userId: "user-A", groupId: "group-1" }

const itemQueries = (queries: ReturnType<typeof createFakeDb>["queries"]) =>
  queries.filter((q) => q.table === "items")

/** 候補として返すアイテム（ID で UPDATE すると returning で返る） */
const candidates = [{ id: "mine-1" }, { id: "mine-2" }]

describe("カタログアイテムのスコープ付き読み込み・更新・削除 (#64・#179)", () => {
  describe("個人リスト", () => {
    it("候補の読み込みは、名前の一覧と groupId なし・作成者・未削除の条件で絞る", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })

      const rows = await findScopedCandidatesByNames(db as unknown as DbExecutor, personal, ["牛乳", "卵"])

      expect(rows).toEqual(candidates)
      const [q] = itemQueries(queries)
      expect(q.kind).toBe("select")
      expect(q.sql).toContain('"items"."name" in ($1, $2)')
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.sql).toContain('"items"."user_id" = $3')
      expect(q.sql).toContain('"items"."deleted_at" is null')
      expect(q.params).toEqual(["牛乳", "卵", "user-A"])
    })

    it("名前がなければ候補を読まない", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })
      expect(await findScopedCandidatesByNames(db as unknown as DbExecutor, personal, [])).toEqual([])
      expect(queries).toHaveLength(0)
    })

    it("購入済み更新は、選んだ ID とスコープ・未削除の条件で絞り、実際に更新した ID を返す", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })

      const ids = await markItemsPurchased(db as unknown as DbExecutor, personal, ["mine-1"], NOW)

      expect(ids).toEqual(["mine-1"])
      const [q] = itemQueries(queries)
      expect(q.kind).toBe("update")
      expect(q.set).toMatchObject({ purchasedAt: NOW })
      expect(q.sql).toContain('"items"."id" in ($1)')
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.sql).toContain('"items"."user_id" = $2')
      expect(q.sql).toContain('"items"."deleted_at" is null')
      expect(q.params).toEqual(["mine-1", "user-A"])
    })

    it("未購入に戻す処理は購入済みのものだけ、かつ作成者のものに限定する", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })

      const ids = await markItemsUnpurchased(db as unknown as DbExecutor, personal, ["mine-1", "mine-2"])

      expect(ids).toEqual(["mine-1", "mine-2"])
      const [q] = itemQueries(queries)
      expect(q.set).toMatchObject({ purchasedAt: null })
      expect(q.sql).toContain('"items"."purchased_at" is not null')
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.params).toEqual(["mine-1", "mine-2", "user-A"])
    })

    it("ID がなければ更新しない", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })
      const exec = db as unknown as DbExecutor
      expect(await markItemsPurchased(exec, personal, [], NOW)).toEqual([])
      expect(await markItemsUnpurchased(exec, personal, [])).toEqual([])
      expect(queries).toHaveLength(0)
    })

    it("削除は名前とgroupIdなし・作成者の条件で絞った論理削除になる（他ユーザーの同名は対象外）", async () => {
      const { db, queries } = createFakeDb({ itemIdsByName: { 牛乳: ["mine-1"] } })

      const ids = await deleteScopedItemsByName(db as unknown as DbExecutor, personal, "牛乳")

      expect(ids).toEqual(["mine-1"])
      const [q] = itemQueries(queries)
      expect(q.kind).toBe("update")
      expect(q.set).toHaveProperty("deletedAt")
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.sql).toContain('"items"."deleted_at" is null')
      expect(q.sql).toContain('"items"."user_id" = $2')
      expect(q.params).toEqual(["牛乳", "user-A"])
    })
  })

  describe("グループリスト", () => {
    it("全操作でグループIDのみで絞り、作成者の個人アイテム(groupIdなし)は対象外", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })
      const exec = db as unknown as DbExecutor

      await findScopedCandidatesByNames(exec, group, ["牛乳"])
      await markItemsPurchased(exec, group, ["mine-1"], NOW)
      await markItemsUnpurchased(exec, group, ["mine-1"])

      const qs = itemQueries(queries)
      expect(qs).toHaveLength(3)
      for (const q of qs) {
        expect(q.sql).toContain('"items"."group_id" = $2')
        expect(q.sql).not.toContain("user_id")
        expect(q.sql).not.toContain('"items"."group_id" is null')
        expect(q.sql).toContain('"items"."deleted_at" is null')
        expect(q.params[1]).toBe("group-1")
      }
    })

    it("削除もグループIDのみで絞る", async () => {
      const { db, queries } = createFakeDb()
      await deleteScopedItemsByName(db as unknown as DbExecutor, group, "牛乳")
      const [q] = itemQueries(queries)
      expect(q.sql).toContain('"items"."group_id" = $2')
      expect(q.params).toEqual(["牛乳", "group-1"])
    })
  })

  describe("所有者が特定できないリスト", () => {
    it("何にも一致しない条件になる", async () => {
      const { db, queries } = createFakeDb({ itemIdsByName: { 牛乳: ["other-1"] } })
      const exec = db as unknown as DbExecutor
      const scope = { userId: null, groupId: null }

      await findScopedCandidatesByNames(exec, scope, ["牛乳"])
      await markItemsPurchased(exec, scope, ["other-1"], NOW)
      await markItemsUnpurchased(exec, scope, ["other-1"])
      await deleteScopedItemsByName(exec, scope, "牛乳")

      const qs = itemQueries(queries)
      expect(qs).toHaveLength(4)
      for (const q of qs) {
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

  describe("sync.push の複合操作の時刻（#62 O4b）", () => {
    it("操作の時刻を渡すと、purchasedAt の時刻がそれ以前のアイテムだけを更新する（購入済み・未購入とも）", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })
      const exec = db as unknown as DbExecutor
      const opTime = "2026-01-02T00:00:00.000Z"

      await markItemsPurchased(exec, personal, ["mine-1"], NOW, opTime)
      await markItemsUnpurchased(exec, personal, ["mine-1"], opTime)

      const qs = itemQueries(queries)
      expect(qs).toHaveLength(2)
      for (const q of qs) {
        expect(q.sql).toContain(`coalesce("items"."field_modified_at" ->> `)
        expect(q.params).toContain(opTime)
      }
    })

    it("操作の時刻を渡さなければ、LWW の条件は付けない（tRPC の操作）", async () => {
      const { db, queries } = createFakeDb({ catalogItems: candidates })
      await markItemsPurchased(db as unknown as DbExecutor, personal, ["mine-1"], NOW)
      expect(itemQueries(queries)[0].sql).not.toContain("coalesce")
    })
  })
})
