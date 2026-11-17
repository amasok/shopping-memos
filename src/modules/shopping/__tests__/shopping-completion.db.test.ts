// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * 買い物の完了・履歴の取り消し・スナップショット・「買いたいもの」の除外（#179。specs/shopping）を、
 * tRPC の router と実 DB で確かめるテスト。sync.push の分は sync-push.db.test.ts
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))

const BEFORE = new Date("2025-12-01T00:00:00.000Z")

describe.skipIf(!TEST_DB_URL)("買い物の規則（tRPC・実 DB）", () => {
  const owner = crypto.randomUUID()
  const stranger = crypto.randomUUID()
  const group = crypto.randomUUID()
  const otherGroup = crypto.randomUUID()

  type Ctx = {
    db: typeof import("@/infrastructure/db/drizzle/client").db
    schema: typeof import("@/infrastructure/db/drizzle/schema")
    drizzle: typeof import("drizzle-orm")
    shopping: typeof import("@/infrastructure/trpc/routers/shopping").shoppingRouter
    catalog: typeof import("@/infrastructure/trpc/routers/catalog").catalogRouter
    service: InstanceType<typeof import("../application/services/ShoppingService").ShoppingService>
  }
  let ctx: Ctx

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL
    const { ShoppingService } = await import("../application/services/ShoppingService")
    const { shoppingListRepository } = await import(
      "../infrastructure/repositories/DrizzleShoppingListRepository"
    )
    ctx = {
      db: (await import("@/infrastructure/db/drizzle/client")).db,
      schema: await import("@/infrastructure/db/drizzle/schema"),
      drizzle: await import("drizzle-orm"),
      shopping: (await import("@/infrastructure/trpc/routers/shopping")).shoppingRouter,
      catalog: (await import("@/infrastructure/trpc/routers/catalog")).catalogRouter,
      service: new ShoppingService(shoppingListRepository),
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

  const shoppingAs = (userId: string) => ctx.shopping.createCaller({ userId } as never)
  const catalogAs = (userId: string) => ctx.catalog.createCaller({ userId } as never)

  async function newItem(over: { name?: string; userId?: string; groupId?: string | null; purchasedAt?: Date | null; deletedAt?: Date | null } = {}) {
    const id = crypto.randomUUID()
    await ctx.db.insert(ctx.schema.items).values({
      id,
      name: over.name ?? "牛乳",
      userId: over.userId ?? owner,
      groupId: over.groupId ?? null,
      purchasedAt: over.purchasedAt ?? null,
      deletedAt: over.deletedAt ?? null,
    })
    return id
  }

  async function newList(
    entries: Array<{ name: string; checked?: boolean; deleted?: boolean }>,
    over: { userId?: string; groupId?: string | null; status?: string; purchasedAt?: Date | null; deletedAt?: Date | null } = {}
  ) {
    const id = crypto.randomUUID()
    await ctx.db.insert(ctx.schema.shoppingLists).values({
      id,
      name: "買い物",
      userId: over.userId ?? owner,
      groupId: over.groupId ?? null,
      status: over.status ?? "in_progress",
      purchasedAt: over.purchasedAt ?? null,
      completedAt: over.purchasedAt ?? null,
      deletedAt: over.deletedAt ?? null,
    })
    const entryIds: Record<string, string> = {}
    for (const e of entries) {
      const entryId = crypto.randomUUID()
      entryIds[e.name] = entryId
      await ctx.db.insert(ctx.schema.listItems).values({
        id: entryId,
        listId: id,
        name: e.name,
        groupId: over.groupId ?? null,
        checked: e.checked ?? false,
        deletedAt: e.deleted ? new Date() : null,
      })
    }
    return { id, entryIds }
  }

  async function rawItem(id: string) {
    const [row] = await ctx.db.select().from(ctx.schema.items).where(ctx.drizzle.eq(ctx.schema.items.id, id))
    return row
  }
  async function rawList(id: string) {
    const [row] = await ctx.db.select().from(ctx.schema.shoppingLists).where(ctx.drizzle.eq(ctx.schema.shoppingLists.id, id))
    return row
  }
  async function rawEntries(listId: string) {
    return ctx.db.select().from(ctx.schema.listItems).where(ctx.drizzle.eq(ctx.schema.listItems.listId, listId))
  }
  /** 同期ログに残ったアイテムの ID（その ID の分だけ） */
  async function itemOps(ids: string[]) {
    const { db, schema, drizzle } = ctx
    const rows = await db
      .select({ entityId: schema.syncOperations.entityId })
      .from(schema.syncOperations)
      .where(drizzle.and(drizzle.eq(schema.syncOperations.entity, "item"), drizzle.inArray(schema.syncOperations.entityId, ids)))
    return rows.map((r) => r.entityId).sort()
  }

  describe("買い物の完了", () => {
    it("チェック済みの商品と同じ名前の商品を購入済みにする", async () => {
      const milk = await newItem()
      const egg = await newItem({ name: "卵" })
      const list = await newList([{ name: "牛乳", checked: true }, { name: "卵" }])

      await shoppingAs(owner).finishShopping({ listId: list.id })

      const after = await rawList(list.id)
      expect((await rawItem(milk)).purchasedAt?.getTime()).toBe(after.purchasedAt?.getTime())
      expect((await rawItem(egg)).purchasedAt).toBeNull()
    })

    it("同じ名前の購入済みの商品も購入日時を完了の時刻にする", async () => {
      const name = `再購入-${crypto.randomUUID()}`
      const fresh = await newItem({ name })
      const old = await newItem({ name, purchasedAt: BEFORE })
      const list = await newList([{ name, checked: true }])

      await shoppingAs(owner).finishShopping({ listId: list.id })

      const at = (await rawList(list.id)).purchasedAt?.getTime()
      expect((await rawItem(fresh)).purchasedAt?.getTime()).toBe(at)
      expect((await rawItem(old)).purchasedAt?.getTime()).toBe(at)
    })

    it("記録する商品の ID は、実際に更新したものだけ（別スコープ・削除済みを含めない）", async () => {
      const name = `記録-${crypto.randomUUID()}`
      const mine = await newItem({ name })
      const minePurchased = await newItem({ name, purchasedAt: BEFORE })
      const others = await newItem({ name, userId: stranger })
      const groups = await newItem({ name, groupId: group })
      const deleted = await newItem({ name, deletedAt: BEFORE })
      const list = await newList([{ name, checked: true }])

      await shoppingAs(owner).finishShopping({ listId: list.id })

      expect(await itemOps([mine, minePurchased, others, groups, deleted])).toEqual([mine, minePurchased].sort())
      expect((await rawItem(others)).purchasedAt).toBeNull()
      expect((await rawItem(groups)).purchasedAt).toBeNull()
      expect((await rawItem(deleted)).purchasedAt).toBeNull()
    })

    it("チェック 0 件のリストも完了でき空の購入履歴になる", async () => {
      const name = `空-${crypto.randomUUID()}`
      const item = await newItem({ name })
      const list = await newList([{ name }])

      await shoppingAs(owner).finishShopping({ listId: list.id })

      expect((await rawList(list.id)).status).toBe("completed")
      expect((await rawEntries(list.id)).every((e) => e.deletedAt !== null)).toBe(true)
      expect((await rawItem(item)).purchasedAt).toBeNull()
      const history = await shoppingAs(owner).getHistory({})
      expect(history.find((h) => h.id === list.id)?.items).toEqual([])
    })

    it("未チェックの商品をリストから外す", async () => {
      const egg = `卵-${crypto.randomUUID()}`
      const eggItem = await newItem({ name: egg })
      const list = await newList([{ name: "牛乳", checked: true }, { name: egg }])

      await shoppingAs(owner).finishShopping({ listId: list.id })

      const history = await shoppingAs(owner).getHistoryById({ id: list.id })
      expect(history.items.map((i) => i.name)).toEqual(["牛乳"])
      const wanted = await catalogAs(owner).getItems({})
      expect(wanted.map((i) => i.id)).toContain(eggItem)
    })

    it("全部チェック済みならリストの商品はすべて残る", async () => {
      const list = await newList([{ name: "牛乳", checked: true }, { name: "卵", checked: true }])

      await shoppingAs(owner).finishShopping({ listId: list.id })

      expect((await rawEntries(list.id)).every((e) => e.deletedAt === null)).toBe(true)
    })

    it("完了したリストに購入日時と場所が入る", async () => {
      const list = await newList([{ name: "牛乳", checked: true }])

      await shoppingAs(owner).finishShopping({ listId: list.id, location: "スーパー" })

      const row = await rawList(list.id)
      expect(row).toMatchObject({ status: "completed", location: "スーパー" })
      expect(row.purchasedAt).not.toBeNull()
      expect(row.completedAt?.getTime()).toBe(row.purchasedAt?.getTime())
    })

    it("完了済みのリストは完了できない", async () => {
      const milk = await newItem({ name: `済-${crypto.randomUUID()}` })
      const list = await newList([{ name: (await rawItem(milk)).name, checked: true }], { status: "completed", purchasedAt: BEFORE })

      await expect(shoppingAs(owner).finishShopping({ listId: list.id })).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect((await rawItem(milk)).purchasedAt).toBeNull()
      expect((await rawList(list.id)).purchasedAt?.getTime()).toBe(BEFORE.getTime())
    })

    it("使えないリストや削除したリストは tRPC で完了できない", async () => {
      const othersList = await newList([{ name: "牛乳", checked: true }], { userId: stranger })
      const otherGroupList = await newList([{ name: "牛乳", checked: true }], { userId: stranger, groupId: otherGroup })
      const deletedList = await newList([{ name: "牛乳", checked: true }], { deletedAt: new Date() })

      for (const list of [othersList, otherGroupList, deletedList]) {
        await expect(shoppingAs(owner).finishShopping({ listId: list.id })).rejects.toMatchObject({ code: "FORBIDDEN" })
        expect((await rawList(list.id)).status).toBe("in_progress")
      }
    })

    it("確認の後に使えなくなったリストは完了しない", async () => {
      const name = `後-${crypto.randomUUID()}`
      const item = await newItem({ name, userId: stranger })
      const list = await newList([{ name, checked: true }], { userId: stranger })

      // アクセスの確認（router）を通った後に権限が変わった場合: サービスを、使えないユーザーで直接呼ぶ
      await expect(ctx.service.finishShopping(list.id, owner)).rejects.toThrow("リストが見つかりません")
      expect((await rawList(list.id)).status).toBe("in_progress")
      expect((await rawItem(item)).purchasedAt).toBeNull()
    })
  })

  describe("履歴の取り消し", () => {
    async function completedList(name: string, over: { userId?: string; groupId?: string | null } = {}) {
      return newList([{ name, checked: true }], { ...over, status: "completed", purchasedAt: BEFORE })
    }

    it("リストの商品と同じ名前の購入済みの商品を未購入に戻す", async () => {
      const name = `戻す-${crypto.randomUUID()}`
      const mine = await newItem({ name, purchasedAt: BEFORE })
      const groups = await newItem({ name, groupId: group, purchasedAt: BEFORE })
      const list = await completedList(name)

      const res = await shoppingAs(owner).revertHistory({ historyId: list.id })

      expect(res.revertedItemIds).toEqual([mine])
      expect((await rawItem(mine)).purchasedAt).toBeNull()
      expect((await rawItem(groups)).purchasedAt?.getTime()).toBe(BEFORE.getTime())
      expect(await itemOps([mine, groups])).toEqual([mine])
    })

    it("取り消したリストは進行中に戻る", async () => {
      const list = await completedList(`進行中-${crypto.randomUUID()}`)

      await shoppingAs(owner).revertHistory({ historyId: list.id })

      expect(await rawList(list.id)).toMatchObject({ status: "in_progress", completedAt: null, purchasedAt: null, location: null })
      const history = await shoppingAs(owner).getHistory({})
      expect(history.map((h) => h.id)).not.toContain(list.id)
    })

    it("購入履歴でないリストは取り消せない", async () => {
      const name = `未完了-${crypto.randomUUID()}`
      const item = await newItem({ name, purchasedAt: BEFORE })
      const list = await newList([{ name }])

      await expect(shoppingAs(owner).revertHistory({ historyId: list.id })).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect((await rawItem(item)).purchasedAt?.getTime()).toBe(BEFORE.getTime())
    })

    it("使えないリストや削除したリストは tRPC で取り消せない", async () => {
      const othersList = await completedList("牛乳", { userId: stranger })
      const otherGroupList = await completedList("牛乳", { userId: stranger, groupId: otherGroup })
      const deletedList = await newList([{ name: "牛乳" }], { status: "completed", purchasedAt: BEFORE, deletedAt: new Date() })

      for (const list of [othersList, otherGroupList, deletedList]) {
        await expect(shoppingAs(owner).revertHistory({ historyId: list.id })).rejects.toMatchObject({ code: "FORBIDDEN" })
        expect((await rawList(list.id)).status).toBe("completed")
      }
    })

    it("確認の後に使えなくなった履歴は取り消さない", async () => {
      const name = `後戻し-${crypto.randomUUID()}`
      const item = await newItem({ name, userId: stranger, purchasedAt: BEFORE })
      const list = await completedList(name, { userId: stranger })

      expect(await ctx.service.revertHistory(list.id, owner)).toBeNull()
      expect((await rawList(list.id)).status).toBe("completed")
      expect((await rawItem(item)).purchasedAt?.getTime()).toBe(BEFORE.getTime())
    })

    it("取り消しの途中で失敗したら何も反映しない", async () => {
      const { db, drizzle } = ctx
      const name = `失敗-${crypto.randomUUID()}`
      const item = await newItem({ name, purchasedAt: BEFORE })
      const list = await completedList(name)
      // カタログの商品を戻した後の、リストの更新を失敗させる（このリストだけ）
      const fn = `fail_${list.id.replace(/-/g, "")}`
      await db.execute(
        drizzle.sql.raw(
          `CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fail'; END $$ LANGUAGE plpgsql;
           CREATE TRIGGER ${fn} BEFORE UPDATE ON shopping_lists FOR EACH ROW WHEN (OLD.id = '${list.id}') EXECUTE FUNCTION ${fn}();`
        )
      )
      try {
        await expect(shoppingAs(owner).revertHistory({ historyId: list.id })).rejects.toBeDefined()
      } finally {
        await db.execute(drizzle.sql.raw(`DROP TRIGGER ${fn} ON shopping_lists; DROP FUNCTION ${fn}();`))
      }

      expect((await rawItem(item)).purchasedAt?.getTime()).toBe(BEFORE.getTime())
      expect((await rawList(list.id)).status).toBe("completed")
      expect(await itemOps([item])).toEqual([])
    })
  })

  describe("リストの商品のスナップショット", () => {
    it("カタログの商品の名前・数量・メモ・タグを写す", async () => {
      const { db, schema } = ctx
      const tag = crypto.randomUUID()
      await db.insert(schema.tags).values({ id: tag, name: "食品", userId: owner })
      const item = crypto.randomUUID()
      await db.insert(schema.items).values({ id: item, name: "牛乳", quantity: 2, memo: "低脂肪", userId: owner })
      await db.insert(schema.itemTags).values({ itemId: item, tagId: tag })
      const list = await newList([])

      const entry = await shoppingAs(owner).addItemToList({ listId: list.id, itemId: item })

      expect(entry).toMatchObject({ name: "牛乳", quantity: 2, memo: "低脂肪", tagIds: [tag], checked: false })
    })

    it("リストの商品の groupId はリストの groupId にする", async () => {
      const item = await newItem({ groupId: group })
      const list = await newList([], { groupId: group })

      const entry = await shoppingAs(owner).addItemToList({ listId: list.id, itemId: item })

      expect(entry.groupId).toBe(group)
    })
  })

  describe("進行中のリストにある商品を「買いたいもの」の一覧から除く", () => {
    const ids = async (groupId?: string) => (await catalogAs(owner).getItems(groupId ? { groupId } : {})).map((i) => i.id)

    it("進行中のリストにある商品と同じ名前の商品は一覧に出ない", async () => {
      const name = `除く-${crypto.randomUUID()}`
      const inList = await newItem({ name })
      const notInList = await newItem({ name: `${name}-別` })
      await newList([{ name }])

      const listed = await ids()
      expect(listed).not.toContain(inList)
      expect(listed).toContain(notInList)
    })

    it("完了したリストや削除したリストの商品は除かない", async () => {
      const name = `除かない-${crypto.randomUUID()}`
      const item = await newItem({ name })
      await newList([{ name }], { status: "completed", purchasedAt: BEFORE })
      await newList([{ name }], { deletedAt: new Date() })

      expect(await ids()).toContain(item)
    })

    it("リストから外した商品は除かない", async () => {
      const name = `外した-${crypto.randomUUID()}`
      const item = await newItem({ name })
      await newList([{ name, deleted: true }])

      expect(await ids()).toContain(item)
    })

    it("ほかのスコープの進行中のリストの商品は除かない", async () => {
      const name = `グループ-${crypto.randomUUID()}`
      const personal = await newItem({ name })
      const inGroup = await newItem({ name, groupId: group })
      await newList([{ name }], { groupId: group })

      expect(await ids()).toContain(personal)
      expect(await ids(group)).not.toContain(inGroup)
    })

    it("ほかのユーザーの個人の進行中のリストの商品は除かない", async () => {
      const name = `他人-${crypto.randomUUID()}`
      const mine = await newItem({ name })
      await newList([{ name }], { userId: stranger })

      expect(await ids()).toContain(mine)
    })
  })
})
