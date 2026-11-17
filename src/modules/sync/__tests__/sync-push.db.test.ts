// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SyncPushOperation } from "@/shared/schemas/sync"

/**
 * sync.push（#62 O4）を実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const T1 = "2026-01-01T00:00:00.000Z"
const T2 = "2026-01-02T00:00:00.000Z"
const T3 = "2026-01-03T00:00:00.000Z"

describe.skipIf(!TEST_DB_URL)("sync.push（実 DB）", () => {
  const owner = crypto.randomUUID()
  const stranger = crypto.randomUUID()
  const group = crypto.randomUUID()
  const otherGroup = crypto.randomUUID()

  type Ctx = {
    db: typeof import("@/infrastructure/db/drizzle/client").db
    schema: typeof import("@/infrastructure/db/drizzle/schema")
    drizzle: typeof import("drizzle-orm")
    service: typeof import("../application/services/SyncPushService").syncPushService
  }
  let ctx: Ctx

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL
    ctx = {
      db: (await import("@/infrastructure/db/drizzle/client")).db,
      schema: await import("@/infrastructure/db/drizzle/schema"),
      drizzle: await import("drizzle-orm"),
      service: (await import("../application/services/SyncPushService")).syncPushService,
    }
    const { db, schema } = ctx
    await db.insert(schema.users).values([owner, stranger].map((u) => ({ id: u, email: `${u}@example.com` })))
    await db.insert(schema.groups).values([
      { id: group, name: "g", inviteCode: group.slice(0, 8).toUpperCase() },
      { id: otherGroup, name: "o", inviteCode: otherGroup.slice(0, 8).toUpperCase() },
    ])
    await db.insert(schema.groupMembers).values([
      { id: crypto.randomUUID(), groupId: group, userId: owner },
      { id: crypto.randomUUID(), groupId: otherGroup, userId: stranger },
    ])
  })

  afterAll(async () => {
    if (!ctx) return
    const { db, schema, drizzle } = ctx
    await db.delete(schema.syncOperations).where(drizzle.inArray(schema.syncOperations.userId, [owner, stranger]))
    await db.delete(schema.users).where(drizzle.inArray(schema.users.id, [owner, stranger]))
    await db.delete(schema.groups).where(drizzle.inArray(schema.groups.id, [group, otherGroup]))
  })

  const op = (over: Partial<SyncPushOperation> & Pick<SyncPushOperation, "entity" | "type">): SyncPushOperation => ({
    opId: crypto.randomUUID(),
    entityId: crypto.randomUUID(),
    clientTime: T1,
    ...over,
  })

  const push1 = async (userId: string, operation: SyncPushOperation) => {
    const { results } = await ctx.service.push(userId, [operation])
    return results[0]
  }

  async function rawItem(id: string) {
    const { db, schema, drizzle } = ctx
    const [row] = await db.select().from(schema.items).where(drizzle.eq(schema.items.id, id))
    return row
  }

  async function itemTagIds(id: string) {
    const { db, schema, drizzle } = ctx
    const rows = await db.select().from(schema.itemTags).where(drizzle.eq(schema.itemTags.itemId, id))
    return rows.map((r) => r.tagId).sort()
  }

  async function createItem(userId = owner, patch: Record<string, unknown> = {}, clientTime = T1) {
    const create = op({ entity: "item", type: "create", patch: { name: "牛乳", ...patch }, clientTime })
    expect(await push1(userId, create)).toMatchObject({ status: "applied" })
    return create.entityId
  }

  async function createTag(userId = owner, groupId?: string) {
    const create = op({ entity: "tag", type: "create", patch: { name: "食品", ...(groupId ? { groupId } : {}) } })
    expect(await push1(userId, create)).toMatchObject({ status: "applied" })
    return create.entityId
  }

  describe("作成", () => {
    it("アイテムを作り、書き込んだすべてのフィールドの時刻を操作の時刻にする", async () => {
      const tag = await createTag()
      const id = await createItem(owner, { quantity: 2, memo: "低脂肪", tagIds: [tag] })
      const row = await rawItem(id)
      expect(row).toMatchObject({ name: "牛乳", quantity: 2, memo: "低脂肪", userId: owner, groupId: null })
      expect(row.fieldModifiedAt).toEqual({ name: T1, quantity: T1, memo: T1, tagIds: T1, purchasedAt: T1 })
      expect(await itemTagIds(id)).toEqual([tag])
    })

    it("同じ opId の再送は duplicate で、二重に適用しない", async () => {
      const create = op({ entity: "item", type: "create", patch: { name: "卵" } })
      expect(await push1(owner, create)).toMatchObject({ status: "applied" })
      expect(await push1(owner, { ...create, patch: { name: "卵（再送）" } })).toEqual({ opId: create.opId, status: "duplicate" })
      expect((await rawItem(create.entityId)).name).toBe("卵")
    })

    it("ほかのユーザーが使った opId は rejected", async () => {
      const create = op({ entity: "item", type: "create", patch: { name: "x" } })
      await push1(owner, create)
      expect(await push1(stranger, { ...create, entityId: crypto.randomUUID() })).toMatchObject({
        status: "rejected",
        reason: "op_conflict",
      })
    })

    it("同じ ID の行が自分のものなら、フィールド単位の更新として扱う", async () => {
      const id = await createItem(owner, {}, T1)
      const again = op({ entity: "item", type: "create", entityId: id, patch: { name: "豆乳", groupId: null }, clientTime: T2 })
      expect(await push1(owner, again)).toMatchObject({ status: "applied" })
      expect((await rawItem(id)).name).toBe("豆乳")
    })

    it("同じ ID の行がほかのユーザーのものなら rejected で、serverRow を返さない", async () => {
      const id = await createItem(stranger)
      const result = await push1(owner, op({ entity: "item", type: "create", entityId: id, patch: { name: "x" } }))
      expect(result).toMatchObject({ status: "rejected", reason: "id_conflict" })
      expect(result.serverRow).toBeUndefined()
      expect((await rawItem(id)).name).toBe("牛乳")
    })

    it("所属していないグループには作れない", async () => {
      const result = await push1(owner, op({ entity: "item", type: "create", patch: { name: "x", groupId: otherGroup } }))
      expect(result).toMatchObject({ status: "rejected", reason: "forbidden" })
    })

    it("所属しているグループに作れる", async () => {
      const result = await push1(owner, op({ entity: "tag", type: "create", patch: { name: "g", groupId: group } }))
      expect(result).toMatchObject({ status: "applied" })
    })

    it("ほかのスコープのタグは付けられない", async () => {
      const foreignTag = await createTag(stranger)
      const result = await push1(owner, op({ entity: "item", type: "create", patch: { name: "x", tagIds: [foreignTag] } }))
      expect(result).toMatchObject({ status: "rejected", reason: "invalid_reference" })
    })

    it("リストのアイテムは、リストのグループで作る。完了したリスト・使えないリストには作れない", async () => {
      const list = op({ entity: "list", type: "create", patch: { name: "週末", groupId: group } })
      await push1(owner, list)
      const li = op({ entity: "listItem", type: "create", patch: { listId: list.entityId, name: "パン" } })
      expect(await push1(owner, li)).toMatchObject({ status: "applied" })
      const { db, schema, drizzle } = ctx
      const [row] = await db.select().from(schema.listItems).where(drizzle.eq(schema.listItems.id, li.entityId))
      expect(row).toMatchObject({ groupId: group, userId: owner, checked: false })

      expect(
        await push1(stranger, op({ entity: "listItem", type: "create", patch: { listId: list.entityId, name: "x" } }))
      ).toMatchObject({ status: "rejected", reason: "invalid_reference" })

      await db.update(schema.shoppingLists).set({ status: "completed" }).where(drizzle.eq(schema.shoppingLists.id, list.entityId))
      expect(
        await push1(owner, op({ entity: "listItem", type: "create", patch: { listId: list.entityId, name: "x" } }))
      ).toMatchObject({ status: "rejected", reason: "list_completed" })
      expect(
        await push1(owner, op({ entity: "listItem", type: "update", entityId: li.entityId, patch: { checked: true } }))
      ).toMatchObject({ status: "rejected", reason: "list_completed" })
    })

    it("不正なパッチはその操作だけ rejected にし、同じリクエストのほかの操作は適用する", async () => {
      const bad = op({ entity: "item", type: "create", patch: { name: "x", isAdmin: true } })
      const badType = op({ entity: "item", type: "create", patch: { name: 1 } })
      const good = op({ entity: "item", type: "create", patch: { name: "ok" } })
      const { results } = await ctx.service.push(owner, [bad, badType, good])
      expect(results.map((r) => [r.status, r.reason])).toEqual([
        ["rejected", "invalid_patch"],
        ["rejected", "invalid_patch"],
        ["applied", undefined],
      ])
      expect(await rawItem(bad.entityId)).toBeUndefined()
    })
  })

  describe("更新（フィールド単位の LWW）", () => {
    it("field_modified_at にキーがないフィールドは、古い時刻でも常に適用する", async () => {
      const { db, schema } = ctx
      const id = crypto.randomUUID()
      await db.insert(schema.items).values({ id, name: "古い行", userId: owner, fieldModifiedAt: {} })
      const result = await push1(owner, op({ entity: "item", type: "update", entityId: id, patch: { name: "新" }, clientTime: T1 }))
      expect(result).toMatchObject({ status: "applied" })
      expect((await rawItem(id)).fieldModifiedAt).toEqual({ name: T1 })
    })

    it("古いフィールドだけを捨てて partial にし、別のフィールドは適用する。serverRow に最新の行を返す", async () => {
      const id = await createItem(owner, {}, T2)
      const result = await push1(
        owner,
        op({
          entity: "item",
          type: "update",
          entityId: id,
          patch: { name: "古い名前", quantity: 5 },
          fieldTimes: { name: T1, quantity: T3 },
          clientTime: T3,
        })
      )
      expect(result.status).toBe("partial")
      expect(result.serverRow).toMatchObject({ id, name: "牛乳", quantity: 5, tagIds: [] })
      const row = await rawItem(id)
      expect(row.name).toBe("牛乳")
      expect(row.fieldModifiedAt).toMatchObject({ name: T2, quantity: T3 })
    })

    it("古い操作を適用した後でも、後から届いた新しい操作は却下されない（updated_at を LWW に使わない）", async () => {
      const { db, schema } = ctx
      const id = crypto.randomUUID()
      await db.insert(schema.items).values({ id, name: "x", userId: owner, fieldModifiedAt: {} })
      await push1(owner, op({ entity: "item", type: "update", entityId: id, patch: { memo: "古い" }, clientTime: T1 }))
      const later = await push1(owner, op({ entity: "item", type: "update", entityId: id, patch: { memo: "新しい" }, clientTime: T2 }))
      expect(later.status).toBe("applied")
      expect((await rawItem(id)).memo).toBe("新しい")
    })

    it("未来の時刻は serverTime に丸める", async () => {
      const id = await createItem()
      const future = "2999-01-01T00:00:00.000Z"
      const { serverTime } = await ctx.service.push(owner, [
        op({ entity: "item", type: "update", entityId: id, patch: { name: "未来" }, clientTime: future }),
      ])
      const stored = (await rawItem(id)).fieldModifiedAt.name
      expect(Date.parse(stored)).toBeLessThanOrEqual(Date.parse(serverTime))
      expect(stored).not.toBe(future)
    })

    it("タグを入れ替えると item_tags も入れ替わる", async () => {
      const a = await createTag()
      const b = await createTag()
      const id = await createItem(owner, { tagIds: [a] })
      await push1(owner, op({ entity: "item", type: "update", entityId: id, patch: { tagIds: [b] }, clientTime: T2 }))
      expect(await itemTagIds(id)).toEqual([b])
    })

    it("ほかのユーザーの行・存在しない行は、どちらも rejected（not_found）で serverRow を返さない", async () => {
      const foreign = await createItem(stranger)
      for (const entityId of [foreign, crypto.randomUUID()]) {
        const result = await push1(owner, op({ entity: "item", type: "update", entityId, patch: { name: "x" } }))
        expect(result).toEqual({ opId: expect.any(String), status: "rejected", reason: "not_found" })
      }
      expect((await rawItem(foreign)).name).toBe("牛乳")
    })

    it("同じグループのメンバーは、グループの行を更新できる", async () => {
      const id = crypto.randomUUID()
      await push1(stranger, op({ entity: "tag", type: "create", entityId: id, patch: { name: "外", groupId: otherGroup } }))
      const tag = await createTag(owner, group)
      expect(
        await push1(owner, op({ entity: "tag", type: "update", entityId: tag, patch: { name: "改名" }, clientTime: T2 }))
      ).toMatchObject({ status: "applied" })
      expect(await push1(owner, op({ entity: "tag", type: "update", entityId: id, patch: { name: "x" } }))).toMatchObject({
        status: "rejected",
      })
    })
  })

  describe("削除（削除が勝つ）", () => {
    it("論理削除し、再送しても applied。削除済みへの更新は conflict で tombstone を返す", async () => {
      const tag = await createTag()
      const id = await createItem(owner, { tagIds: [tag] })
      expect(await push1(owner, op({ entity: "item", type: "delete", entityId: id }))).toMatchObject({ status: "applied" })
      expect((await rawItem(id)).deletedAt).not.toBeNull()
      expect(await itemTagIds(id)).toEqual([])
      expect(await push1(owner, op({ entity: "item", type: "delete", entityId: id }))).toMatchObject({ status: "applied" })

      // 削除より新しい時刻の更新でも、削除が勝つ
      const update = await push1(
        owner,
        op({ entity: "item", type: "update", entityId: id, patch: { name: "x" }, clientTime: "2026-06-01T00:00:00.000Z" })
      )
      expect(update.status).toBe("conflict")
      expect(update.serverRow).toMatchObject({ id, deletedAt: expect.any(Date) })
      expect((await rawItem(id)).name).toBe("牛乳")

      // 削除済みの ID での作成も conflict
      expect(await push1(owner, op({ entity: "item", type: "create", entityId: id, patch: { name: "x" } }))).toMatchObject({
        status: "conflict",
      })
    })

    it("リストを削除すると、リストのアイテムも論理削除する", async () => {
      const list = op({ entity: "list", type: "create", patch: { name: "l" } })
      await push1(owner, list)
      const li = op({ entity: "listItem", type: "create", patch: { listId: list.entityId, name: "x" } })
      await push1(owner, li)
      expect(await push1(owner, op({ entity: "list", type: "delete", entityId: list.entityId }))).toMatchObject({
        status: "applied",
      })
      const { db, schema, drizzle } = ctx
      const [row] = await db.select().from(schema.listItems).where(drizzle.eq(schema.listItems.id, li.entityId))
      expect(row.deletedAt).not.toBeNull()
    })

    it("ほかのユーザーの行は削除できない（rejected）", async () => {
      const id = await createItem(stranger)
      expect(await push1(owner, op({ entity: "item", type: "delete", entityId: id }))).toMatchObject({
        status: "rejected",
        reason: "not_found",
      })
      expect((await rawItem(id)).deletedAt).toBeNull()
    })
  })

  it("処理の結果を sync_operations に記録する", async () => {
    const bad = op({ entity: "item", type: "update", patch: { name: "x" } })
    await push1(owner, bad)
    const { db, schema, drizzle } = ctx
    const [row] = await db.select().from(schema.syncOperations).where(drizzle.eq(schema.syncOperations.id, bad.opId))
    expect(row).toMatchObject({ userId: owner, entity: "item", entityId: bad.entityId, operation: "update" })
    expect(JSON.parse(row.payload)).toMatchObject({ status: "rejected", reason: "not_found", patch: { name: "x" } })
  })
})
