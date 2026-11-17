// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * sync.pull（#62 O5）を実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const OLD = new Date("2026-01-01T00:00:00.000Z")

describe.skipIf(!TEST_DB_URL)("sync.pull（実 DB）", () => {
  type Ctx = {
    db: typeof import("@/infrastructure/db/drizzle/client").db
    schema: typeof import("@/infrastructure/db/drizzle/schema")
    drizzle: typeof import("drizzle-orm")
    pull: typeof import("../application/services/SyncPullService")
  }
  let ctx: Ctx
  const users: string[] = []
  const groupIds: string[] = []

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL
    ctx = {
      db: (await import("@/infrastructure/db/drizzle/client")).db,
      schema: await import("@/infrastructure/db/drizzle/schema"),
      drizzle: await import("drizzle-orm"),
      pull: await import("../application/services/SyncPullService"),
    }
  })

  afterAll(async () => {
    if (!ctx) return
    const { db, schema, drizzle } = ctx
    if (users.length) await db.delete(schema.users).where(drizzle.inArray(schema.users.id, users))
    if (groupIds.length) await db.delete(schema.groups).where(drizzle.inArray(schema.groups.id, groupIds))
  })

  /** テストごとに別のユーザー（ほかのテストのデータと混ざらないように） */
  async function newUser() {
    const id = crypto.randomUUID()
    users.push(id)
    await ctx.db.insert(ctx.schema.users).values({ id, email: `${id}@example.com` })
    return id
  }

  async function newGroup(...members: string[]) {
    const id = crypto.randomUUID()
    groupIds.push(id)
    await ctx.db.insert(ctx.schema.groups).values({ id, name: "g", inviteCode: id.slice(0, 8).toUpperCase() })
    for (const userId of members) {
      await ctx.db.insert(ctx.schema.groupMembers).values({ id: crypto.randomUUID(), groupId: id, userId })
    }
    return id
  }

  async function insertTag(userId: string, over: Record<string, unknown> = {}) {
    const id = crypto.randomUUID()
    await ctx.db.insert(ctx.schema.tags).values({ id, name: "t", userId, ...over })
    return id
  }

  /** hasMore が false になるまで取り、ページを返す */
  async function pullAll(userId: string, cursor?: string) {
    const pages = []
    let next = cursor
    for (let i = 0; i < 20; i++) {
      const page = await ctx.pull.syncPullService.pull(userId, next)
      pages.push(page)
      next = page.nextCursor
      if (!page.hasMore) break
    }
    return { pages, cursor: next as string }
  }

  const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.id as string).sort()

  it("最初の pull: 自分の個人データと所属グループのデータを、tombstone と tagIds つきで返す", async () => {
    const { db, schema } = ctx
    const me = await newUser()
    const other = await newUser()
    const group = await newGroup(me, other)
    const otherGroup = await newGroup(other)

    const myTag = await insertTag(me)
    const groupTag = await insertTag(other, { groupId: group })
    await insertTag(other) // 他人の個人データ
    await insertTag(other, { groupId: otherGroup }) // 所属していないグループ
    const deletedTag = await insertTag(me, { deletedAt: new Date() })
    const item = crypto.randomUUID()
    await db.insert(schema.items).values({ id: item, name: "牛乳", userId: me })
    await db.insert(schema.itemTags).values({ itemId: item, tagId: myTag })
    const list = crypto.randomUUID()
    await db.insert(schema.shoppingLists).values({ id: list, name: "l", userId: other, groupId: group })
    const li = crypto.randomUUID()
    // user_id のないリストのアイテムも、親のリストで判定して返す
    await db.insert(schema.listItems).values({ id: li, listId: list, name: "x", groupId: group })

    const { pages } = await pullAll(me)
    expect(pages).toHaveLength(1)
    const [page] = pages
    expect(ids(page.changes.tags)).toEqual([myTag, groupTag, deletedTag].sort())
    expect(page.changes.tags.find((t) => t.id === deletedTag)?.deletedAt).toBeInstanceOf(Date)
    expect(page.changes.items).toEqual([expect.objectContaining({ id: item, tagIds: [myTag] })])
    expect(ids(page.changes.lists)).toEqual([list])
    expect(ids(page.changes.listItems)).toEqual([li])
    expect(page.memberships.groupIds).toEqual([group])
    expect(page.hasMore).toBe(false)
    expect(Date.parse(page.serverTime)).not.toBeNaN()
  })

  it("次の pull はカーソル以降の差分だけ（60 秒さかのぼった分を含む）を返す", async () => {
    const { db, schema, drizzle } = ctx
    const me = await newUser()
    const old1 = await insertTag(me, { updatedAt: OLD })
    const old2 = await insertTag(me, { updatedAt: OLD })
    // カーソルの時刻になる行（OLD の 1 日後）
    const marker = await insertTag(me, { updatedAt: new Date("2026-01-02T00:00:00.000Z") })
    const { cursor } = await pullAll(me)

    await db.update(schema.tags).set({ name: "変更", updatedAt: new Date() }).where(drizzle.eq(schema.tags.id, old1))
    const { pages } = await pullAll(me, cursor)
    const returned = pages.flatMap((p) => p.changes.tags)
    // marker はさかのぼりの範囲に入るので重複して返る（クライアントは冪等に適用する）
    expect(ids(returned)).toEqual([old1, marker].sort())
    expect(ids(returned)).not.toContain(old2)
  })

  it("カーソルより前の時刻で後からコミットされた行も、60 秒以内なら次の pull で取れる", async () => {
    const me = await newUser()
    const at = new Date("2026-03-01T00:00:00.000Z")
    await insertTag(me, { updatedAt: at })
    const { cursor } = await pullAll(me)

    // カーソルの時刻より 30 秒前・120 秒前の時刻で、後から書き込まれた（長いトランザクションのコミットが遅れた）
    const late = await insertTag(me, { updatedAt: new Date(at.getTime() - 30_000) })
    const tooOld = await insertTag(me, { updatedAt: new Date(at.getTime() - 120_000) })
    const returned = (await pullAll(me, cursor)).pages.flatMap((p) => p.changes.tags)
    expect(ids(returned)).toContain(late)
    expect(ids(returned)).not.toContain(tooOld)
  })

  it("500 行でページを分け、さかのぼりは最初のページだけ（同じ時刻の行が多くても、重複も漏れもなく終わる）", async () => {
    const { db, schema } = ctx
    const me = await newUser()
    await insertTag(me, { updatedAt: OLD })
    const { cursor } = await pullAll(me)

    // カーソルの後に、同じ時刻の行を 600 件
    const same = new Date()
    const created = Array.from({ length: 600 }, () => crypto.randomUUID())
    await db.insert(schema.tags).values(created.map((id) => ({ id, name: "多", userId: me, updatedAt: same })))

    const { pages } = await pullAll(me, cursor)
    expect(pages.map((p) => [p.changes.tags.length, p.hasMore])).toEqual([
      [500, true],
      [101, false], // 600 件 + さかのぼりで重複して返る OLD の 1 件
    ])
    const returned = pages.flatMap((p) => p.changes.tags).map((t) => t.id as string)
    expect(new Set(returned).size).toBe(returned.length)
    expect(created.every((id) => returned.includes(id))).toBe(true)
  })

  it("DB の now() で書いたマイクロ秒の時刻でも、ページの境目で重複も漏れもない", async () => {
    const { db, schema, drizzle } = ctx
    const me = await newUser()
    const created = Array.from({ length: 600 }, () => crypto.randomUUID())
    // 同じ文の now() なので、600 件すべてが同じマイクロ秒の時刻になる
    await db.insert(schema.tags).values(created.map((id) => ({ id, name: "μ", userId: me, updatedAt: drizzle.sql`now()` })))

    const { pages } = await pullAll(me)
    expect(pages.map((p) => [p.changes.tags.length, p.hasMore])).toEqual([
      [500, true],
      [100, false],
    ])
    const returned = pages.flatMap((p) => p.changes.tags).map((t) => t.id as string)
    expect(new Set(returned).size).toBe(600)
  })

  it("所属グループのデータと、グループのない自分のデータの両方を、ページの境目をまたいで取れる", async () => {
    const { db, schema } = ctx
    const me = await newUser()
    const other = await newUser()
    const group = await newGroup(me, other)
    const personal = Array.from({ length: 300 }, () => crypto.randomUUID())
    const shared = Array.from({ length: 300 }, () => crypto.randomUUID())
    await db.insert(schema.tags).values(personal.map((id) => ({ id, name: "個人", userId: me })))
    await db.insert(schema.tags).values(shared.map((id) => ({ id, name: "共有", userId: other, groupId: group })))
    await insertTag(other) // 他人の個人データは含まない

    const { pages } = await pullAll(me)
    expect(pages.map((p) => p.hasMore)).toEqual([true, false])
    const returned = pages.flatMap((p) => p.changes.tags).map((t) => t.id as string)
    expect(returned.sort()).toEqual([...personal, ...shared].sort())
  })

  it("時刻として正しくない値のカーソルは、DB に送らず InvalidCursorError", async () => {
    const me = await newUser()
    const cursor = Buffer.from(
      JSON.stringify({ v: 1, pos: { tags: { at: "2026-13-45 99:99:99.000000", id: "x", started: false }, items: null, lists: null, listItems: null } })
    ).toString("base64url")
    await expect(ctx.pull.syncPullService.pull(me, cursor)).rejects.toBeInstanceOf(ctx.pull.InvalidCursorError)
  })

  it("ページが埋まって取れなかったエンティティは、次のページで最初から（さかのぼって）取る", async () => {
    const { db, schema } = ctx
    const me = await newUser()
    const tagIds = Array.from({ length: 500 }, () => crypto.randomUUID())
    await db.insert(schema.tags).values(tagIds.map((id) => ({ id, name: "t", userId: me })))
    const item = crypto.randomUUID()
    await db.insert(schema.items).values({ id: item, name: "i", userId: me })

    const { pages } = await pullAll(me)
    expect(pages[0]).toMatchObject({ hasMore: true })
    expect(pages[0].changes.tags).toHaveLength(500)
    expect(pages[0].changes.items).toEqual([])
    expect(pages.flatMap((p) => p.changes.items).map((i) => i.id)).toEqual([item])
  })

  it("親のリストが削除済みのリストのアイテムは、tombstone として返す", async () => {
    const { db, schema } = ctx
    const me = await newUser()
    const list = crypto.randomUUID()
    const deletedAt = new Date()
    await db.insert(schema.shoppingLists).values({ id: list, name: "l", userId: me, deletedAt })
    const li = crypto.randomUUID()
    await db.insert(schema.listItems).values({ id: li, listId: list, name: "取り残し" })

    const [page] = (await pullAll(me)).pages
    expect(page.changes.listItems).toEqual([expect.objectContaining({ id: li, deletedAt })])
  })

  it("抜けたグループのデータは返さず、memberships からも消える", async () => {
    const { db, schema, drizzle } = ctx
    const me = await newUser()
    const group = await newGroup(me)
    const tag = await insertTag(me, { groupId: group })
    expect(ids((await pullAll(me)).pages[0].changes.tags)).toEqual([tag])

    await db.delete(schema.groupMembers).where(drizzle.eq(schema.groupMembers.userId, me))
    const [page] = (await pullAll(me)).pages
    expect(page.changes.tags).toEqual([])
    expect(page.memberships.groupIds).toEqual([])
  })

  it("不正なカーソルは InvalidCursorError", async () => {
    const me = await newUser()
    await expect(ctx.pull.syncPullService.pull(me, "not-a-cursor")).rejects.toBeInstanceOf(ctx.pull.InvalidCursorError)
  })
})
