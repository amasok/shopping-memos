// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * 論理削除・同期用の列の更新・更新/削除の WHERE のスコープ（#62 O3b）を、実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const OLD = new Date("2026-01-01T00:00:00Z")

describe.skipIf(!TEST_DB_URL)("論理削除と同期用の列（実 DB）", () => {
  const run = Math.random().toString(36).slice(2, 10)
  const id = (name: string) => `sd-${run}-${name}`
  const owner = id("owner")
  const stranger = id("stranger")
  const group = id("group")

  type Ctx = {
    db: typeof import("@/infrastructure/db/drizzle/client").db
    schema: typeof import("@/infrastructure/db/drizzle/schema")
    drizzle: typeof import("drizzle-orm")
    errors: typeof import("@/infrastructure/db/errors")
    items: typeof import("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository").itemRepository
    tags: typeof import("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository").tagRepository
    lists: typeof import("@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository").shoppingListRepository
    scope: typeof import("@/modules/shopping/application/services/catalogItemScope")
    areTagsInScope: typeof import("@/modules/catalog/application/services/ownership").areTagsInScope
    entityAccess: typeof import("@/modules/sync/infrastructure/entityAccess")
    merge: typeof import("@/modules/sync/application/services/DataMergeService").dataMergeService
  }
  let ctx: Ctx

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL
    ctx = {
      db: (await import("@/infrastructure/db/drizzle/client")).db,
      schema: await import("@/infrastructure/db/drizzle/schema"),
      drizzle: await import("drizzle-orm"),
      errors: await import("@/infrastructure/db/errors"),
      items: (await import("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"))
        .itemRepository,
      tags: (await import("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"))
        .tagRepository,
      lists: (
        await import("@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository")
      ).shoppingListRepository,
      scope: await import("@/modules/shopping/application/services/catalogItemScope"),
      areTagsInScope: (await import("@/modules/catalog/application/services/ownership")).areTagsInScope,
      entityAccess: await import("@/modules/sync/infrastructure/entityAccess"),
      merge: (await import("@/modules/sync/application/services/DataMergeService")).dataMergeService,
    }
    const { db, schema } = ctx
    await db
      .insert(schema.users)
      .values([owner, stranger].map((u) => ({ id: u, email: `${u}@example.com` })))
    await db.insert(schema.groups).values({ id: group, name: "g", inviteCode: `SD${run}`.toUpperCase() })
    await db.insert(schema.groupMembers).values({ id: id("gm"), groupId: group, userId: owner })
  })

  afterAll(async () => {
    if (!ctx) return
    const { db, schema, drizzle } = ctx
    await db.delete(schema.users).where(drizzle.inArray(schema.users.id, [owner, stranger]))
    await db.delete(schema.groups).where(drizzle.eq(schema.groups.id, group))
  })

  /** 行を直接読む（論理削除済みも含む） */
  async function rawItem(itemId: string) {
    const { db, schema, drizzle } = ctx
    const [row] = await db.select().from(schema.items).where(drizzle.eq(schema.items.id, itemId))
    return row
  }

  async function rawTagLinks(itemId: string) {
    const { db, schema, drizzle } = ctx
    return db.select().from(schema.itemTags).where(drizzle.eq(schema.itemTags.itemId, itemId))
  }

  /** updated_at を過去にしておく（更新で now() になったことを確かめるため） */
  async function ageItem(itemId: string) {
    const { db, schema, drizzle } = ctx
    await db.update(schema.items).set({ updatedAt: OLD }).where(drizzle.eq(schema.items.id, itemId))
  }

  async function newTag(name: string, groupId?: string) {
    return ctx.tags.create({ id: id(`tag-${name}`), name, userId: owner, groupId })
  }

  async function newItem(name: string, tagIds: string[] = [], groupId?: string) {
    return ctx.items.create({ id: id(`item-${name}`), name, quantity: 1, userId: owner, groupId, tagIds })
  }

  describe("アイテム", () => {
    it("作成すると、書き込んだすべてのフィールドの field_modified_at にサーバー時刻が入る", async () => {
      const item = await newItem("create")
      const row = await rawItem(item.id)
      expect(Object.keys(row.fieldModifiedAt).sort()).toEqual(
        ["memo", "name", "purchasedAt", "quantity", "tagIds"].sort()
      )
      expect(row.fieldModifiedAt.name).toMatch(ISO_MS)
      expect(row.deletedAt).toBeNull()
    })

    it("同じ ID で作成すると、自分の行でも他人の行でも削除済みでも、同じ DuplicateIdError になる", async () => {
      const item = await newItem("dup")
      await expect(
        ctx.items.create({ id: item.id, name: "x", quantity: 1, userId: owner })
      ).rejects.toBeInstanceOf(ctx.errors.DuplicateIdError)
      // 他人の行の ID（存在の有無を漏らさないよう、同じエラー・同じメッセージ）
      const foreign = ctx.items.create({ id: item.id, name: "x", quantity: 1, userId: stranger })
      await expect(foreign).rejects.toThrow("このアイテムの ID はすでに使われています")
      await ctx.items.delete(item.id, owner)
      await expect(
        ctx.items.create({ id: item.id, name: "x", quantity: 1, userId: owner })
      ).rejects.toBeInstanceOf(ctx.errors.DuplicateIdError)
    })

    it("更新すると updated_at が now() になり、書き込んだフィールドのキーだけが更新される", async () => {
      const item = await newItem("update")
      const before = (await rawItem(item.id)).fieldModifiedAt
      await ageItem(item.id)

      await ctx.items.update({ id: item.id, name: "renamed" }, owner)

      const row = await rawItem(item.id)
      expect(row.name).toBe("renamed")
      expect(row.updatedAt.getTime()).toBeGreaterThan(OLD.getTime())
      expect(row.fieldModifiedAt.name >= before.name).toBe(true)
      expect(row.fieldModifiedAt.quantity).toBe(before.quantity)
    })

    it("購入済みにすると purchasedAt のキーと updated_at が更新される", async () => {
      const item = await newItem("purchase")
      await ageItem(item.id)
      await ctx.items.markAsPurchased(item.id, owner)
      const row = await rawItem(item.id)
      expect(row.purchasedAt).not.toBeNull()
      expect(row.updatedAt.getTime()).toBeGreaterThan(OLD.getTime())
      expect(row.fieldModifiedAt.purchasedAt).toMatch(ISO_MS)
    })

    it("スコープ外のユーザーは更新・削除できず（RowNotFoundError）、行は変わらない", async () => {
      const item = await newItem("scoped")
      await expect(ctx.items.update({ id: item.id, name: "hacked" }, stranger)).rejects.toBeInstanceOf(
        ctx.errors.RowNotFoundError
      )
      await expect(ctx.items.delete(item.id, stranger)).rejects.toBeInstanceOf(ctx.errors.RowNotFoundError)
      await expect(ctx.items.markAsPurchased(item.id, stranger)).rejects.toBeInstanceOf(
        ctx.errors.RowNotFoundError
      )
      const row = await rawItem(item.id)
      expect(row.name).toBe("scoped")
      expect(row.deletedAt).toBeNull()
      expect(row.purchasedAt).toBeNull()
    })

    it("グループのメンバーはグループのアイテムを更新できる", async () => {
      const item = await newItem("group-item", [], group)
      await ctx.items.update({ id: item.id, quantity: 3 }, owner)
      expect((await rawItem(item.id)).quantity).toBe(3)
    })

    it("削除は論理削除になり、タグの関連は消え、取得・アクセス判定の対象から外れる", async () => {
      const tag = await newTag("for-deleted-item")
      const item = await newItem("delete", [tag.id])
      await ageItem(item.id)

      await ctx.items.delete(item.id, owner)

      const row = await rawItem(item.id)
      expect(row.deletedAt).not.toBeNull()
      expect(row.updatedAt.getTime()).toBeGreaterThan(OLD.getTime())
      expect(await rawTagLinks(item.id)).toEqual([])
      expect(await ctx.items.findById(item.id)).toBeNull()
      expect(await ctx.items.canAccess(item.id, owner)).toBe(false)
      const listed = await ctx.items.findMany({ userId: owner, includePurchased: true })
      expect(listed.map((i) => i.id)).not.toContain(item.id)
    })

    it("削除済みのアイテムは更新・再削除できない", async () => {
      const item = await newItem("deleted-twice")
      await ctx.items.delete(item.id, owner)
      await expect(ctx.items.update({ id: item.id, name: "x" }, owner)).rejects.toBeInstanceOf(
        ctx.errors.RowNotFoundError
      )
      await expect(ctx.items.delete(item.id, owner)).rejects.toBeInstanceOf(ctx.errors.RowNotFoundError)
    })
  })

  describe("タグ", () => {
    it("削除は論理削除になり、関連を外したアイテムの updated_at と tagIds のキーが更新される", async () => {
      const tag = await newTag("delete")
      const item = await newItem("tagged", [tag.id])
      await ageItem(item.id)

      await ctx.tags.delete(tag.id, owner)

      expect(await ctx.tags.findById(tag.id)).toBeNull()
      const tagsListed = await ctx.tags.findMany({ userId: owner })
      expect(tagsListed.map((t) => t.id)).not.toContain(tag.id)
      expect(await rawTagLinks(item.id)).toEqual([])
      const row = await rawItem(item.id)
      expect(row.updatedAt.getTime()).toBeGreaterThan(OLD.getTime())
      expect(row.fieldModifiedAt.tagIds).toMatch(ISO_MS)
      expect((await ctx.items.findById(item.id))?.tags).toEqual([])
    })

    it("削除済みのタグはスコープ内のタグとして扱わない", async () => {
      const tag = await newTag("deleted-scope")
      await ctx.tags.delete(tag.id, owner)
      expect(await ctx.areTagsInScope([tag.id], { userId: owner, groupId: null })).toBe(false)
    })

    it("スコープ外のユーザーはタグを更新・削除できない", async () => {
      const tag = await newTag("scoped")
      await expect(ctx.tags.update({ id: tag.id, name: "x" }, stranger)).rejects.toBeInstanceOf(
        ctx.errors.RowNotFoundError
      )
      await expect(ctx.tags.delete(tag.id, stranger)).rejects.toBeInstanceOf(ctx.errors.RowNotFoundError)
      expect((await ctx.tags.findById(tag.id))?.name).toBe("scoped")
    })

    it("使用数は削除済みのアイテムを数えない", async () => {
      const tag = await newTag("usage")
      await newItem("usage-live", [tag.id])
      const gone = await newItem("usage-gone", [tag.id])
      await ctx.items.delete(gone.id, owner)
      const found = (await ctx.tags.findMany({ userId: owner })).find((t) => t.id === tag.id)
      expect(found?.usageCount).toBe(1)
    })
  })

  describe("リスト", () => {
    async function newList(name: string) {
      const list = await ctx.lists.create({ id: id(`list-${name}`), name, userId: owner })
      const a = await ctx.lists.addItem({ id: id(`li-${name}-a`), listId: list.id, name: "a", quantity: 1 })
      const b = await ctx.lists.addItem({ id: id(`li-${name}-b`), listId: list.id, name: "b", quantity: 1 })
      return { list, a, b }
    }

    async function rawListItem(listItemId: string) {
      const { db, schema, drizzle } = ctx
      const [row] = await db.select().from(schema.listItems).where(drizzle.eq(schema.listItems.id, listItemId))
      return row
    }

    it("作成したリストとリストのアイテムに field_modified_at が入る", async () => {
      const { list, a } = await newList("create")
      const { db, schema, drizzle } = ctx
      const [row] = await db.select().from(schema.shoppingLists).where(drizzle.eq(schema.shoppingLists.id, list.id))
      expect(row.fieldModifiedAt.name).toMatch(ISO_MS)
      expect((await rawListItem(a.id)).fieldModifiedAt.checked).toMatch(ISO_MS)
    })

    it("リストのアイテムの ID が重複すると DuplicateIdError になる", async () => {
      const { list, a } = await newList("dup")
      await expect(
        ctx.lists.addItem({ id: a.id, listId: list.id, name: "x", quantity: 1 })
      ).rejects.toBeInstanceOf(ctx.errors.DuplicateIdError)
    })

    it("削除はリストとリストのアイテムの論理削除になり、取得の対象から外れる", async () => {
      const { list, a } = await newList("delete")
      await ctx.lists.delete(list.id, owner)

      expect(await ctx.lists.findById(list.id)).toBeNull()
      expect(await ctx.lists.canAccess(list.id, owner)).toBe(false)
      const listed = await ctx.lists.findMany({ userId: owner, includeCompleted: true })
      expect(listed.map((l) => l.id)).not.toContain(list.id)
      expect((await rawListItem(a.id)).deletedAt).not.toBeNull()
      expect(await ctx.lists.findItemById(a.id)).toBeNull()
    })

    it("リストのアイテムを外すと論理削除になり、リストの取得に含まれない", async () => {
      const { list, a, b } = await newList("remove")
      await ctx.lists.removeItem(a.id, owner)
      expect((await rawListItem(a.id)).deletedAt).not.toBeNull()
      const found = await ctx.lists.findById(list.id)
      expect(found?.items.map((i) => i.id)).toEqual([b.id])
    })

    it("チェックすると checked のキーと updated_at が更新され、スコープ外のユーザーはチェックできない", async () => {
      const { a } = await newList("check")
      const before = (await rawListItem(a.id)).fieldModifiedAt.checked
      await ctx.lists.updateItem({ id: a.id, checked: true }, owner)
      const row = await rawListItem(a.id)
      expect(row.checked).toBe(true)
      expect(row.fieldModifiedAt.checked >= before).toBe(true)
      await expect(ctx.lists.updateItem({ id: a.id, checked: false }, stranger)).rejects.toBeInstanceOf(
        ctx.errors.RowNotFoundError
      )
      expect((await rawListItem(a.id)).checked).toBe(true)
    })

    it("スコープ外のユーザーはリストを更新・削除できない", async () => {
      const { list } = await newList("scoped")
      await expect(ctx.lists.update({ id: list.id, name: "x" }, stranger)).rejects.toBeInstanceOf(
        ctx.errors.RowNotFoundError
      )
      await expect(ctx.lists.delete(list.id, stranger)).rejects.toBeInstanceOf(ctx.errors.RowNotFoundError)
      expect((await ctx.lists.findById(list.id))?.name).toBe("scoped")
    })

    it("購入履歴は削除済みのリストを含まない", async () => {
      const { list } = await newList("history")
      await ctx.lists.update({ id: list.id, purchasedAt: new Date() }, owner)
      await ctx.lists.delete(list.id, owner)
      const history = await ctx.lists.findPurchaseHistory({ userId: owner })
      expect(history.map((l) => l.id)).not.toContain(list.id)
    })
  })

  describe("同名のカタログアイテムの操作（#64）", () => {
    it("同名のアイテムの削除は論理削除で、削除済みのアイテムは購入済みにしない", async () => {
      const item = await newItem("same-name")
      const scope = { userId: owner, groupId: null }
      const deleted = await ctx.scope.deleteScopedItemsByName(ctx.db, scope, item.name)
      expect(deleted).toEqual([item.id])
      expect((await rawItem(item.id)).deletedAt).not.toBeNull()

      const purchased = await ctx.scope.markScopedItemsPurchasedByName(ctx.db, scope, item.name, new Date())
      expect(purchased).toEqual([])
    })
  })
  describe("削除したものと同じ名前での作り直し", () => {
    it("アイテムとタグは、削除したものと同じ名前で作り直せ、一覧には新しいものだけが出る", async () => {
      const oldTag = await ctx.tags.create({ id: id("re-tag-old"), name: "作り直しタグ", userId: owner })
      const oldItem = await ctx.items.create({
        id: id("re-item-old"), name: "作り直し", quantity: 1, userId: owner, tagIds: [oldTag.id],
      })
      await ctx.items.delete(oldItem.id, owner)
      await ctx.tags.delete(oldTag.id, owner)

      const newTag = await ctx.tags.create({ id: id("re-tag-new"), name: "作り直しタグ", userId: owner })
      const newItem = await ctx.items.create({
        id: id("re-item-new"), name: "作り直し", quantity: 1, userId: owner, tagIds: [newTag.id],
      })

      const itemsListed = (await ctx.items.findMany({ userId: owner, includePurchased: true })).filter(
        (i) => i.name === "作り直し"
      )
      expect(itemsListed.map((i) => i.id)).toEqual([newItem.id])
      expect(itemsListed[0].tags).toEqual([{ id: newTag.id, name: "作り直しタグ" }])
      const tagsListed = (await ctx.tags.findMany({ userId: owner })).filter((t) => t.name === "作り直しタグ")
      expect(tagsListed.map((t) => [t.id, t.usageCount])).toEqual([[newTag.id, 1]])
    })

    it("同名のアイテムを未購入に戻す処理は、削除済みのアイテムを対象にしない", async () => {
      const scope = { userId: owner, groupId: null }
      const gone = await newItem("revert-same")
      await ctx.items.markAsPurchased(gone.id, owner)
      await ctx.items.delete(gone.id, owner)
      expect(await ctx.scope.markScopedItemsUnpurchasedByName(ctx.db, scope, gone.name)).toEqual([])
      expect((await rawItem(gone.id)).purchasedAt).not.toBeNull()
    })
  })

  describe("履歴（購入済みのリスト）の表示", () => {
    async function newHistory(name: string, tagId: string) {
      const list = await ctx.lists.create({ id: id(`hist-${name}`), name, userId: owner })
      const li = await ctx.lists.addItem({
        id: id(`hist-li-${name}`), listId: list.id, name, quantity: 1, tagIds: [tagId],
      })
      await ctx.lists.updateItem({ id: li.id, checked: true }, owner)
      await ctx.lists.update({ id: list.id, status: "completed" as never, purchasedAt: new Date() }, owner)
      return { list, li }
    }

    const historyItems = async (listId: string) =>
      (await ctx.lists.findPurchaseHistory({ userId: owner })).find((l) => l.id === listId)?.items

    it("同じ名前のカタログのアイテムを削除しても、履歴のアイテムは残る（物理削除のときと同じ）", async () => {
      const tag = await newTag("hist-keep")
      const catalog = await newItem("履歴に残る", [tag.id])
      const { list, li } = await newHistory("履歴に残る", tag.id)

      await ctx.items.delete(catalog.id, owner)

      expect(await historyItems(list.id)).toEqual([
        expect.objectContaining({ id: li.id, name: "履歴に残る", tags: [{ id: tag.id, name: "hist-keep" }] }),
      ])
    })

    it("タグを削除すると、履歴のアイテムのタグの表示から消える（物理削除のときと同じ）", async () => {
      const tag = await newTag("hist-gone")
      const { list, li } = await newHistory("タグが消える", tag.id)

      await ctx.tags.delete(tag.id, owner)

      expect(await historyItems(list.id)).toEqual([expect.objectContaining({ id: li.id, tags: [] })])
    })
  })

  describe("同期のアクセス判定とゲストのデータの取り込み", () => {
    it("削除済みのエンティティはアクセス判定で not_found。ID の重なりの判定では見つかる", async () => {
      const item = await newItem("access-deleted")
      await ctx.items.delete(item.id, owner)
      expect(await ctx.entityAccess.checkEntityAccess(ctx.db, "item", item.id, owner)).toBe("not_found")
      expect(
        await ctx.entityAccess.findEntityScope(ctx.db, "item", item.id, { includeDeleted: true })
      ).toEqual({ userId: owner, groupId: null })
    })

    it("削除済みのリストのアイテムは、アクセス判定で not_found", async () => {
      const list = await ctx.lists.create({ id: id("access-list"), name: "l", userId: owner })
      const li = await ctx.lists.addItem({ id: id("access-li"), listId: list.id, name: "x", quantity: 1 })
      await ctx.lists.delete(list.id, owner)
      expect(await ctx.entityAccess.checkEntityAccess(ctx.db, "listItem", li.id, owner)).toBe("not_found")
      expect(await ctx.entityAccess.checkEntityAccess(ctx.db, "list", list.id, owner)).toBe("not_found")
    })

    it("取り込み: 削除済みの同名のタグには寄せず、新しいタグを作る。削除済みと同じ ID は復活させない", async () => {
      const { db, schema, drizzle } = ctx
      const deleted = await ctx.tags.create({ id: crypto.randomUUID(), name: "取り込みタグ", userId: owner })
      await ctx.tags.delete(deleted.id, owner)
      const guestTagId = crypto.randomUUID()
      const empty = { items: [], lists: [], listItems: [], history: [] }

      await ctx.merge.merge(owner, {
        ...empty,
        tags: [
          { id: guestTagId, name: "取り込みタグ", createdAt: new Date() },
          { id: deleted.id, name: "取り込みタグ", createdAt: new Date() },
        ],
      })

      const rows = await db
        .select({ id: schema.tags.id, deletedAt: schema.tags.deletedAt })
        .from(schema.tags)
        .where(drizzle.and(drizzle.eq(schema.tags.userId, owner), drizzle.eq(schema.tags.name, "取り込みタグ")))
      const byId = new Map(rows.map((r) => [r.id, r.deletedAt]))
      expect(byId.get(deleted.id)).not.toBeNull()
      expect(byId.has(guestTagId)).toBe(true)
      expect(byId.get(guestTagId)).toBeNull()
    })
  })
})
