// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * OtpEventRepository（#61 A3a 1.3）を実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 * 同時の照合を確かめるため、接続を 10 本にした専用の drizzle を使う（アプリの既定は開発では 1 本）
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const HMAC_KEY = "test-otp-event-hmac-key-0123456789abcdef"
const IP = "203.0.113.1"
const OTHER_IP = "198.51.100.7"
const MIN = 60 * 1000
const DAY = 24 * 60 * MIN

describe.skipIf(!TEST_DB_URL)("OtpEventRepository（実 DB）", () => {
  type Ctx = {
    client: import("postgres").Sql
    db: import("drizzle-orm/postgres-js").PostgresJsDatabase<typeof import("@/infrastructure/db/drizzle/schema")>
    schema: typeof import("@/infrastructure/db/drizzle/schema")
    drizzle: typeof import("drizzle-orm")
    Repo: typeof import("../infrastructure/OtpEventRepository").OtpEventRepository
  }
  let ctx: Ctx
  const hashes: string[] = []

  beforeAll(async () => {
    const postgres = (await import("postgres")).default
    const { drizzle } = await import("drizzle-orm/postgres-js")
    const schema = await import("@/infrastructure/db/drizzle/schema")
    const client = postgres(TEST_DB_URL!, { max: 10, prepare: false, onnotice: () => {} })
    ctx = {
      client,
      db: drizzle(client, { schema }),
      schema,
      drizzle: await import("drizzle-orm"),
      Repo: (await import("../infrastructure/OtpEventRepository")).OtpEventRepository,
    }
  })

  afterAll(async () => {
    if (!ctx) return
    if (hashes.length) {
      await ctx.db.delete(ctx.schema.otpEvents).where(ctx.drizzle.inArray(ctx.schema.otpEvents.emailHash, hashes))
    }
    await ctx.client.end()
  })

  /** テストごとに別のアドレス（ほかのテストの記録と混ざらないように） */
  function setup() {
    const repo = new ctx.Repo(ctx.db, HMAC_KEY)
    const email = `${crypto.randomUUID()}@example.com`
    hashes.push(repo.hashEmail(email))
    return { repo, email }
  }

  async function rows(repo: InstanceType<Ctx["Repo"]>, email: string) {
    return ctx.db
      .select()
      .from(ctx.schema.otpEvents)
      .where(ctx.drizzle.eq(ctx.schema.otpEvents.emailHash, repo.hashEmail(email)))
  }

  it("記録にはアドレスの平文が残らない", async () => {
    const { repo, email } = setup()
    expect(await repo.guardSend(email, IP)).toEqual({ kind: "send" })

    const [row] = await rows(repo, email)
    expect(row.kind).toBe("sent")
    expect(row.ip).toBe(IP)
    expect(row.emailHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain(email)
    expect(JSON.stringify(row)).not.toContain(email.split("@")[0])
  })

  it("同じアドレスは同じ HMAC になり、鍵が違えば別の値になる", () => {
    const a = new ctx.Repo(ctx.db, HMAC_KEY)
    const b = new ctx.Repo(ctx.db, `${HMAC_KEY}-other`)
    expect(a.hashEmail("taro@example.com")).toBe(a.hashEmail("taro@example.com"))
    expect(a.hashEmail("taro@example.com")).not.toBe(b.hashEmail("taro@example.com"))
  })

  it("正規化していないアドレスは受け付けない（大文字・空白の違いで別のキーにしない）", () => {
    const repo = new ctx.Repo(ctx.db, HMAC_KEY)
    expect(() => repo.hashEmail("Taro@Example.com")).toThrow()
    expect(() => repo.hashEmail(" taro@example.com")).toThrow()
  })

  it("黙って見送った送信は記録しない", async () => {
    const { repo, email } = setup()
    const now = new Date()
    await repo.guardSend(email, IP, now)
    expect(await repo.guardSend(email, OTHER_IP, new Date(now.getTime() + 10_000))).toEqual({
      kind: "silent",
      reason: "resend-interval",
    })
    expect((await rows(repo, email)).map((r) => r.kind)).toEqual(["sent"])
  })

  it("同時に照合を送っても 3 回までしか照合されない", async () => {
    const { repo, email } = setup()
    await repo.guardSend(email, IP)
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.guardVerify(email, IP)))

    expect(results.filter((r) => r.kind === "verify")).toHaveLength(3)
    expect(results.filter((r) => r.kind === "reject" && r.reason === "code-attempts-exceeded")).toHaveLength(7)
    expect((await rows(repo, email)).filter((r) => r.kind === "attempted")).toHaveLength(3)
  })

  it("同時に照合を送っても 10 回でロックされる", async () => {
    const { repo, email } = setup()
    // 送り直しをはさんで 9 回失敗する（1 つのコードの 3 回には当たらない）
    const start = Date.now() - 60 * MIN
    for (let i = 0; i < 3; i++) {
      const t = start + i * 10 * MIN
      await repo.guardSend(email, IP, new Date(t))
      for (let j = 1; j <= 3; j++) await repo.guardVerify(email, IP, new Date(t + j * 1000))
    }
    await repo.guardSend(email, IP)

    const results = await Promise.all(Array.from({ length: 3 }, () => repo.guardVerify(email, IP)))
    expect(results.filter((r) => r.kind === "verify")).toEqual([{ kind: "verify", locksAfter: true }])
    expect(results.filter((r) => r.kind === "reject" && r.reason === "locked")).toHaveLength(2)

    const kinds = (await rows(repo, email)).map((r) => r.kind)
    expect(kinds.filter((k) => k === "attempted")).toHaveLength(10)
    expect(kinds.filter((k) => k === "locked")).toHaveLength(1)
  })

  it("ロック中でも別の IP からは送信・照合に進める", async () => {
    const { repo, email } = setup()
    const start = Date.now() - 60 * MIN
    for (let i = 0; i < 4; i++) {
      const t = start + i * 10 * MIN
      await repo.guardSend(email, IP, new Date(t))
      for (let j = 1; j <= 3 && i * 3 + j <= 10; j++) await repo.guardVerify(email, IP, new Date(t + j * 1000))
    }
    expect(await repo.guardVerify(email, IP)).toEqual({ kind: "reject", reason: "locked" })
    expect(await repo.guardSend(email, IP)).toEqual({ kind: "silent", reason: "locked" })

    expect(await repo.guardSend(email, OTHER_IP)).toEqual({ kind: "send" })
    expect(await repo.guardVerify(email, OTHER_IP)).toEqual({ kind: "verify", locksAfter: false })
  })

  it("unlocked より前の照合は累積ロックに数えない", async () => {
    const { repo, email } = setup()
    const start = Date.now() - 60 * MIN
    for (let i = 0; i < 3; i++) {
      const t = start + i * 10 * MIN
      await repo.guardSend(email, IP, new Date(t))
      for (let j = 1; j <= 3; j++) await repo.guardVerify(email, IP, new Date(t + j * 1000))
    }
    await repo.recordUnlocked(email, OTHER_IP, new Date(start + 35 * MIN))
    await repo.guardSend(email, IP)
    expect(await repo.guardVerify(email, IP)).toEqual({ kind: "verify", locksAfter: false })
  })

  it("30 日より古い記録は消える", async () => {
    const { repo, email } = setup()
    const { email: oldEmail } = setup()
    const now = new Date()
    const old = new Date(now.getTime() - 30 * DAY - MIN)
    const recent = new Date(now.getTime() - 23 * 60 * MIN)
    await ctx.db.insert(ctx.schema.otpEvents).values([
      { id: crypto.randomUUID(), emailHash: repo.hashEmail(oldEmail), ip: IP, kind: "sent", createdAt: old },
      { id: crypto.randomUUID(), emailHash: repo.hashEmail(oldEmail), ip: IP, kind: "sent", createdAt: recent },
    ])

    // 新しいインスタンスの最初の送信のついでに消す
    await repo.guardSend(email, IP, now)
    const left = (await rows(repo, oldEmail)).map((r) => r.createdAt.getTime())
    expect(left).toEqual([recent.getTime()])
  })

  it("掃除は、送信のついでにプロセス（インスタンス）ごとに 1 日 1 回だけ呼ぶ", async () => {
    // 同じ DB をほかのテストのファイルも並列に使うので、DB の行ではなく呼び出しの回数で確かめる
    const { repo, email } = setup()
    const purge = vi.spyOn(repo, "purgeExpired")
    const now = new Date()
    await repo.guardSend(email, IP, now)
    expect(purge).toHaveBeenCalledTimes(1)
    await repo.guardSend(`${crypto.randomUUID()}@example.com`, IP, new Date(now.getTime() + 60 * MIN))
    expect(purge).toHaveBeenCalledTimes(1)
    await repo.guardSend(`${crypto.randomUUID()}@example.com`, IP, new Date(now.getTime() + DAY + MIN))
    expect(purge).toHaveBeenCalledTimes(2)
  })

  it("別の IP の行を 1000 件以上積まれても、この IP のロックは解けない（読み込みの上限で落とさない）", async () => {
    const { repo, email } = setup()
    const start = Date.now() - 60 * MIN
    for (let i = 0; i < 4; i++) {
      const t = start + i * 10 * MIN
      await repo.guardSend(email, IP, new Date(t))
      for (let j = 1; j <= 3 && i * 3 + j <= 10; j++) await repo.guardVerify(email, IP, new Date(t + j * 1000))
    }
    expect(await repo.guardVerify(email, IP)).toEqual({ kind: "reject", reason: "locked" })

    // 攻撃者が別の IP から、ロックの後の時刻の行を 1200 件積む
    const hash = repo.hashEmail(email)
    const base = Date.now() - 5 * MIN
    const rowsToAdd = Array.from({ length: 1200 }, (_, i) => ({
      id: crypto.randomUUID(),
      emailHash: hash,
      ip: `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`,
      kind: i % 4 === 0 ? "sent" : "attempted",
      createdAt: new Date(base + i * 100),
    }))
    for (let i = 0; i < rowsToAdd.length; i += 300) {
      await ctx.db.insert(ctx.schema.otpEvents).values(rowsToAdd.slice(i, i + 300))
    }

    expect(await repo.guardVerify(email, IP)).toEqual({ kind: "reject", reason: "locked" })
    expect(await repo.guardSend(email, IP, new Date(Date.now() + 2 * MIN))).toMatchObject({ kind: "silent" })
  })
})
