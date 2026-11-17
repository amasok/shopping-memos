// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * canAccess（Item / Tag / ShoppingList）を、実 DB で直接確かめるテスト（#151）
 *
 * DB の実行が必要なので、OWNERSHIP_DB_TEST_URL があるときだけ流す（なければスキップ）。
 * 流し方: npm run test:db（docker の postgres に一時 DB を作り、migrate して、終わったら消す）
 * OWNERSHIP_DB_TEST_URL の DB には、テストが users / groups などを作る（実行ごとに消す）。本番や開発の DB を指さないこと。
 */
const TEST_DB_URL = process.env.OWNERSHIP_DB_TEST_URL

// テストはデータを作って消すので、ローカルの DB 以外では流さない
if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("OWNERSHIP_DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

describe.skipIf(!TEST_DB_URL)("canAccess（実 DB）", () => {
  const run = Math.random().toString(36).slice(2, 10)
  const id = (name: string) => `own-${run}-${name}`

  type Ctx = {
    db: typeof import("@/infrastructure/db/drizzle/client").db
    schema: typeof import("@/infrastructure/db/drizzle/schema")
    itemRepository: typeof import("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository").itemRepository
    tagRepository: typeof import("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository").tagRepository
    listRepository: typeof import("@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository").shoppingListRepository
  }
  let ctx: Ctx

  const owner = id("owner")
  const member = id("member")
  const stranger = id("stranger")
  // 作成者だが、グループのメンバーではない（グループを抜けた）
  const leaver = id("leaver")
  const group = id("group")

  beforeAll(async () => {
    // クライアントは import 時に DATABASE_URL を読むので、import の前に差し替える
    process.env.DATABASE_URL = TEST_DB_URL
    const { db } = await import("@/infrastructure/db/drizzle/client")
    const schema = await import("@/infrastructure/db/drizzle/schema")
    const { itemRepository } = await import(
      "@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"
    )
    const { tagRepository } = await import(
      "@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"
    )
    const { shoppingListRepository } = await import(
      "@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository"
    )
    ctx = { db, schema, itemRepository, tagRepository, listRepository: shoppingListRepository }

    await db.insert(schema.users).values(
      [owner, member, stranger, leaver].map((u) => ({ id: u, email: `${u}@example.com` }))
    )
    await db
      .insert(schema.groups)
      .values({ id: group, name: "g", inviteCode: run.toUpperCase() })
    await db.insert(schema.groupMembers).values([
      { id: id("gm-owner"), groupId: group, userId: owner, role: "owner" },
      { id: id("gm-member"), groupId: group, userId: member },
    ])

    const { items, tags, shoppingLists } = schema
    await db.insert(items).values([
      { id: id("item-personal"), name: "牛乳", userId: owner, groupId: null },
      { id: id("item-group"), name: "卵", userId: owner, groupId: group },
      { id: id("item-left"), name: "米", userId: leaver, groupId: group },
      { id: id("item-orphan"), name: "パン", userId: null, groupId: null },
    ])
    await db.insert(tags).values([
      { id: id("tag-personal"), name: "食品", userId: owner, groupId: null },
      { id: id("tag-group"), name: "共有", userId: owner, groupId: group },
      { id: id("tag-left"), name: "抜けた", userId: leaver, groupId: group },
      { id: id("tag-orphan"), name: "孤児", userId: null, groupId: null },
    ])
    await db.insert(shoppingLists).values([
      { id: id("list-personal"), name: "個人", userId: owner, groupId: null },
      { id: id("list-group"), name: "共有", userId: owner, groupId: group },
      { id: id("list-left"), name: "抜けた", userId: leaver, groupId: group },
      { id: id("list-orphan"), name: "孤児", userId: null, groupId: null },
    ])
  })

  afterAll(async () => {
    if (!ctx) return
    const { db, schema } = ctx
    const { inArray } = await import("drizzle-orm")
    // groups / users を消すと、cascade / set null で残りも片づく。孤児（userId なし）は個別に消す
    await db.delete(schema.items).where(inArray(schema.items.id, [id("item-orphan")]))
    await db.delete(schema.tags).where(inArray(schema.tags.id, [id("tag-orphan")]))
    await db.delete(schema.shoppingLists).where(inArray(schema.shoppingLists.id, [id("list-orphan")]))
    await db.delete(schema.users).where(inArray(schema.users.id, [owner, member, stranger, leaver]))
    await db.delete(schema.groups).where(inArray(schema.groups.id, [group]))
  })

  const cases: Array<[string, "personal" | "group" | "left" | "orphan", string, boolean]> = [
    ["作成者は個人データを使える", "personal", "owner", true],
    ["グループのメンバーは個人データを使えない", "personal", "member", false],
    ["他人は個人データを使えない", "personal", "stranger", false],
    ["作成者（メンバー）はグループのデータを使える", "group", "owner", true],
    ["グループのメンバーはグループのデータを使える", "group", "member", true],
    ["グループ外の人はグループのデータを使えない", "group", "stranger", false],
    ["グループを抜けた作成者は、グループのデータを使えない", "left", "leaver", false],
    ["グループのメンバーは、抜けた人が作ったグループのデータを使える", "left", "member", true],
    ["所有者が分からないデータはだれも使えない（作成者でも）", "orphan", "owner", false],
    ["所有者が分からないデータは他人も使えない", "orphan", "stranger", false],
  ]

  describe.each([
    ["Item", "item", (c: Ctx) => c.itemRepository],
    ["Tag", "tag", (c: Ctx) => c.tagRepository],
    ["ShoppingList", "list", (c: Ctx) => c.listRepository],
  ] as const)("%s", (_label, prefix, repo) => {
    it.each(cases)("%s", async (_name, kind, who, expected) => {
      const user = { owner, member, stranger, leaver }[who as "owner" | "member" | "stranger" | "leaver"]
      const ok = await repo(ctx).canAccess(id(`${prefix}-${kind}`), user)
      expect(ok).toBe(expected)
    })

    it("存在しない ID は使えない", async () => {
      expect(await repo(ctx).canAccess(id(`${prefix}-none`), owner)).toBe(false)
    })
  })
})
