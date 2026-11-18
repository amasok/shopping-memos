// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * セッション・ログアウト・認証の route を通した流れ（#61 A3a 3.2・3.3）を実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 * tRPC の createContext が使う getAuth を、このテストで作った Better Auth に差し替える
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const current = vi.hoisted(() => ({ auth: undefined as unknown }))
vi.mock("../server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server")>()
  return { ...actual, getAuth: async () => current.auth }
})

type Schema = typeof import("@/infrastructure/db/drizzle/schema")

describe.skipIf(!TEST_DB_URL)("セッションと認証の route（実 DB）", () => {
  let client: import("postgres").Sql
  let db: import("drizzle-orm/postgres-js").PostgresJsDatabase<Schema>
  let schema: Schema
  let drizzle: typeof import("drizzle-orm")
  let server: typeof import("../server")
  let createAuthRouteHandler: typeof import("../route").createAuthRouteHandler
  let createContext: typeof import("@/infrastructure/trpc/server").createContext
  let resolveAuthEnv: typeof import("../env").resolveAuthEnv
  let Repo: typeof import("@/modules/identity/infrastructure/OtpEventRepository").OtpEventRepository
  const emails: string[] = []

  beforeAll(async () => {
    const postgres = (await import("postgres")).default
    schema = await import("@/infrastructure/db/drizzle/schema")
    client = postgres(TEST_DB_URL!, { max: 5, prepare: false, onnotice: () => {} })
    db = (await import("drizzle-orm/postgres-js")).drizzle(client, { schema })
    drizzle = await import("drizzle-orm")
    server = await import("../server")
    createAuthRouteHandler = (await import("../route")).createAuthRouteHandler
    createContext = (await import("@/infrastructure/trpc/server")).createContext
    resolveAuthEnv = (await import("../env")).resolveAuthEnv
    Repo = (await import("@/modules/identity/infrastructure/OtpEventRepository")).OtpEventRepository
  })

  afterAll(async () => {
    if (!db) return
    if (emails.length) {
      await db.delete(schema.users).where(drizzle.inArray(schema.users.email, emails))
      const repo = new Repo(db, resolveAuthEnv({}).otpEventHmacKey)
      await db
        .delete(schema.otpEvents)
        .where(drizzle.inArray(schema.otpEvents.emailHash, emails.map((e) => repo.hashEmail(e))))
    }
    await client.end()
  })

  let ipSeq = 0
  function setup(origin = "http://localhost:3000") {
    const env = { ...resolveAuthEnv({}), baseURL: origin, trustedOrigins: [origin] }
    const mails: { to: string; otp: string }[] = []
    let clock = Date.now()
    const auth = server.createAuth({
      db,
      env,
      emailSender: {
        async sendOtp({ to, otp }) {
          mails.push({ to, otp })
        },
        async sendNotice() {},
      },
      otpEvents: new Repo(db, env.otpEventHmacKey),
      verifyTurnstile: async () => true,
      now: () => new Date(clock),
    })
    current.auth = auth
    const route = createAuthRouteHandler({ handle: (r) => auth.handler(r), trustedOrigins: () => env.trustedOrigins })
    ipSeq++
    // ほかの db テストのファイル（better-auth.db.test は 10.11.*）と重ならない
    const ip = `10.12.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
    const email = `${crypto.randomUUID()}@example.com`
    emails.push(email)

    const call = (method: string, path: string, body?: unknown, cookie?: string) =>
      route(
        new Request(`${origin}/api/auth${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            origin,
            "x-real-ip": ip,
            "x-turnstile-token": "ok",
            ...(cookie ? { cookie } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      )

    async function login(): Promise<{ cookie: string; setCookie: string; userId: string }> {
      expect((await call("POST", server.SEND_OTP_PATH, { email, type: "sign-in" })).status).toBe(200)
      const otp = [...mails].reverse().find((m) => m.to === email)!.otp
      const res = await call("POST", server.SIGN_IN_OTP_PATH, { email, otp })
      expect(res.status).toBe(200)
      const setCookie = res.headers.get("set-cookie")!
      const cookie = setCookie.split(";")[0]
      return { cookie, setCookie, userId: (await res.json()).user.id }
    }

    const contextWith = (cookie: string) =>
      createContext({ req: new Request(`${origin}/api/trpc/x`, { headers: { cookie } }) })

    /** 同じアドレスへの再送の間隔（60 秒）を越える */
    const advance = (ms: number) => {
      clock += ms
    }

    return { call, login, contextWith, email, route, advance }
  }

  it("許可したパスは動く（送信 → ログイン → セッションの取得 → ログアウト）", async () => {
    const t = setup()
    const { cookie } = await t.login()
    const session = await t.call("GET", "/get-session", undefined, cookie)
    expect(session.status).toBe(200)
    expect((await session.json()).user.email).toBe(t.email)
    expect((await t.call("POST", "/sign-out", {}, cookie)).status).toBe(200)
  })

  it("ログインすると tRPC でそのユーザーとして扱われる", async () => {
    const t = setup()
    const { cookie, userId } = await t.login()
    const ctx = await t.contextWith(cookie)
    expect(ctx.userId).toBe(userId)
    expect(ctx.user?.email).toBe(t.email)
  })

  it("切り替え前の Auth.js の Cookie ではログインしていない扱いになる", async () => {
    const t = setup()
    await t.login()
    for (const cookie of [
      "authjs.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0.x.y.z.w",
      "__Secure-authjs.session-token=eyJhbGciOiJkaXIi.x.y.z.w",
    ]) {
      expect(await t.contextWith(cookie)).toEqual({})
    }
  })

  it("ログアウトした後は控えておいた Cookie も使えない", async () => {
    const t = setup()
    const { cookie } = await t.login()
    expect((await t.contextWith(cookie)).userId).toBeDefined()
    expect((await t.call("POST", "/sign-out", {}, cookie)).status).toBe(200)
    expect(await t.contextWith(cookie)).toEqual({})
  })

  it("すべての端末からログアウトすると、ほかの端末のセッションも使えなくなる（#61 A4）", async () => {
    const t = setup()
    const deviceA = await t.login()
    // もう一方の端末で、同じユーザーとしてログインする
    t.advance(61 * 1000)
    const deviceB = await t.login()
    expect(deviceB.userId).toBe(deviceA.userId)
    expect((await t.contextWith(deviceB.cookie)).userId).toBe(deviceA.userId)

    const res = await t.call("POST", "/revoke-sessions", {}, deviceA.cookie)
    expect(res.status).toBe(200)
    expect(await t.contextWith(deviceB.cookie)).toEqual({})
    expect(await t.contextWith(deviceA.cookie)).toEqual({})
    const rest = await db.select().from(schema.authSessions).where(drizzle.eq(schema.authSessions.userId, deviceA.userId))
    expect(rest).toHaveLength(0)
  })

  it("DB からセッションを消すと、すぐ使えなくなる（cookieCache を使わない）", async () => {
    const t = setup()
    const { cookie, userId } = await t.login()
    await db.delete(schema.authSessions).where(drizzle.eq(schema.authSessions.userId, userId))
    expect(await t.contextWith(cookie)).toEqual({})
  })

  it("セッションの Cookie の属性", async () => {
    const t = setup("https://shopping.counoco.net")
    const { setCookie } = await t.login()
    expect(setCookie).toMatch(/^__Secure-better-auth\.session_token=/)
    expect(setCookie).toMatch(/;\s*Secure/i)
    expect(setCookie).toMatch(/;\s*HttpOnly/i)
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i)
  })

  it("使っている間は、1 日ごとに DB と Cookie の期限が延びる", async () => {
    const t = setup()
    const { cookie, userId } = await t.login()
    // 2 日前に作られたセッション（残り 28 日）にする
    const day = 24 * 60 * 60 * 1000
    await db
      .update(schema.authSessions)
      .set({ expiresAt: new Date(Date.now() + 28 * day), updatedAt: new Date(Date.now() - 2 * day) })
      .where(drizzle.eq(schema.authSessions.userId, userId))

    const res = await t.call("GET", "/get-session", undefined, cookie)
    expect(res.status).toBe(200)
    const setCookie = res.headers.get("set-cookie") ?? ""
    expect(setCookie).toMatch(/better-auth\.session_token=/)
    const maxAge = Number(/Max-Age=(\d+)/i.exec(setCookie)?.[1] ?? 0)
    expect(Math.round(maxAge / (24 * 60 * 60))).toBe(30)

    const [row] = await db.select().from(schema.authSessions).where(drizzle.eq(schema.authSessions.userId, userId))
    expect(Math.round((row.expiresAt.getTime() - Date.now()) / day)).toBe(30)
  })

  it("セッションの取得は rate limit をかけない（IP のヘッダがない画面のリクエストが共有の枠を使い切らない）", async () => {
    const t = setup()
    const { cookie } = await t.login()
    const statuses = new Set<number>()
    for (let i = 0; i < 120; i++) {
      const res = await t.route(
        new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie } })
      )
      statuses.add(res.status)
    }
    expect([...statuses]).toEqual([200])
  })

  it("セッションは 30 日で失効する", async () => {
    const t = setup()
    const { userId } = await t.login()
    const [row] = await db.select().from(schema.authSessions).where(drizzle.eq(schema.authSessions.userId, userId))
    const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    expect(Math.round(days)).toBe(30)
  })
})
