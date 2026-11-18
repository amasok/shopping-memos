// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * 表示名の保存（identity.updateProfile。#61 A4）を、tRPC の router と実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

vi.mock("@/infrastructure/auth/server", () => ({ getAuth: vi.fn() }))

describe.skipIf(!TEST_DB_URL)("表示名の保存（tRPC・実 DB）", () => {
  const me = crypto.randomUUID()
  const other = crypto.randomUUID()
  const group = crypto.randomUUID()

  type Ctx = {
    db: typeof import("@/infrastructure/db/drizzle/client").db
    schema: typeof import("@/infrastructure/db/drizzle/schema")
    drizzle: typeof import("drizzle-orm")
    identity: typeof import("@/infrastructure/trpc/routers/identity").identityRouter
  }
  let ctx: Ctx

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL
    ctx = {
      db: (await import("@/infrastructure/db/drizzle/client")).db,
      schema: await import("@/infrastructure/db/drizzle/schema"),
      drizzle: await import("drizzle-orm"),
      identity: (await import("@/infrastructure/trpc/routers/identity")).identityRouter,
    }
    const { db, schema } = ctx
    await db.insert(schema.users).values([
      { id: me, email: `${me}@example.com`, name: "" },
      { id: other, email: `${other}@example.com`, name: "ほかの家族" },
    ])
    await db.insert(schema.groups).values({ id: group, name: "家族", inviteCode: group.slice(0, 8).toUpperCase() })
    await db.insert(schema.groupMembers).values([
      { id: crypto.randomUUID(), groupId: group, userId: me, role: "owner" },
      { id: crypto.randomUUID(), groupId: group, userId: other, role: "member" },
    ])
  })

  afterAll(async () => {
    if (!ctx) return
    const { db, schema, drizzle } = ctx
    await db.delete(schema.groups).where(drizzle.eq(schema.groups.id, group))
    await db.delete(schema.users).where(drizzle.inArray(schema.users.id, [me, other]))
  })

  const caller = (userId?: string) =>
    ctx.identity.createCaller(userId ? { userId, user: { id: userId, name: "", email: `${userId}@example.com` } } : {})

  async function nameOf(id: string) {
    const [row] = await ctx.db
      .select({ name: ctx.schema.users.name })
      .from(ctx.schema.users)
      .where(ctx.drizzle.eq(ctx.schema.users.id, id))
    return row?.name
  }

  it("前後の空白を除いた表示名を保存して返す", async () => {
    await expect(caller(me).updateProfile({ name: "  たろう  " })).resolves.toEqual({ name: "たろう" })
    expect(await nameOf(me)).toBe("たろう")
  })

  it("設定画面で表示名を変えるとグループのメンバー一覧に反映される", async () => {
    await caller(me).updateProfile({ name: "パパ" })
    const members = await caller(other).getGroupMembers({ groupId: group })
    const mine = members.find((m) => m.userId === me) as { user: { name: string } } | undefined
    expect(mine?.user.name).toBe("パパ")
  })

  it("他人の表示名は変えられない（入力の userId は使われない）", async () => {
    await caller(me).updateProfile({ name: "自分", userId: other } as never)
    expect(await nameOf(me)).toBe("自分")
    expect(await nameOf(other)).toBe("ほかの家族")
  })

  it("ログインしていないと表示名を変えられない", async () => {
    await expect(caller().updateProfile({ name: "だれか" })).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })

  it.each([
    ["改行や制御文字を含む表示名は保存できない", "たろ\nう"],
    ["向きを変える文字やゼロ幅の文字を含む表示名は保存できない", "‮うろた"],
    ["向きを変える文字やゼロ幅の文字を含む表示名は保存できない（ゼロ幅）", "たろ\u200bう"],
    ["空白だけの表示名は保存できない", "   "],
    ["50 文字を超える表示名は保存できない", "あ".repeat(51)],
  ])("%s（API）", async (_label, name) => {
    const before = await nameOf(me)
    await expect(caller(me).updateProfile({ name })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(await nameOf(me)).toBe(before)
  })
})
