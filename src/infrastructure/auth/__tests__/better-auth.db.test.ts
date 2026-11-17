// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Better Auth のメールのコードでのログイン（#61 A3a 2.1〜2.5）を実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 * - HTTP の入口（auth.handler）を通すと、Better Auth の IP ごとの rate limit もかかる（2.3）
 * - auth.api で呼ぶと rate limit はかからず、hooks だけが動く（2.1・2.2）
 * - 時刻（otpAbusePolicy の判定）は差し替えた時計で進める。テストごとに別のアドレスと IP を使う
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const BASE = "http://localhost:3000"
const MIN = 60 * 1000

type Server = typeof import("../server")
type Schema = typeof import("@/infrastructure/db/drizzle/schema")
type Mail = { to: string; otp: string }

describe.skipIf(!TEST_DB_URL)("Better Auth のメールのコードでのログイン（実 DB）", () => {
  let client: import("postgres").Sql
  let db: import("drizzle-orm/postgres-js").PostgresJsDatabase<Schema>
  let schema: Schema
  let drizzle: typeof import("drizzle-orm")
  let server: Server
  let Repo: typeof import("@/modules/identity/infrastructure/OtpEventRepository").OtpEventRepository
  let resolveAuthEnv: typeof import("../env").resolveAuthEnv
  const userIds: string[] = []
  const emails: string[] = []

  beforeAll(async () => {
    const postgres = (await import("postgres")).default
    schema = await import("@/infrastructure/db/drizzle/schema")
    client = postgres(TEST_DB_URL!, { max: 10, prepare: false, onnotice: () => {} })
    db = (await import("drizzle-orm/postgres-js")).drizzle(client, { schema })
    drizzle = await import("drizzle-orm")
    server = await import("../server")
    Repo = (await import("@/modules/identity/infrastructure/OtpEventRepository")).OtpEventRepository
    resolveAuthEnv = (await import("../env")).resolveAuthEnv
  })

  afterAll(async () => {
    if (!db) return
    const found = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(drizzle.inArray(schema.users.email, emails.length ? emails : ["-"]))
    const ids = [...userIds, ...found.map((u) => u.id)]
    if (ids.length) await db.delete(schema.users).where(drizzle.inArray(schema.users.id, ids))
    if (emails.length) {
      const repo = new Repo(db, resolveAuthEnv({}).otpEventHmacKey)
      await db
        .delete(schema.otpEvents)
        .where(drizzle.inArray(schema.otpEvents.emailHash, emails.map((e) => repo.hashEmail(e))))
      await db
        .delete(schema.authVerifications)
        .where(drizzle.inArray(schema.authVerifications.identifier, emails.map((e) => `sign-in-otp-${e}`)))
    }
    await client.end()
  })

  let ipSeq = 0
  /**
   * テストごとに別の IP（rate limit の記録が混ざらないように）。test:db は 1 回ごとに新しい DB なので、
   * このファイルの中で重ならなければよい。ほかのファイル（session.db.test は 10.250.*）とも重ならない 10.11.* を使う
   */
  function newIp() {
    ipSeq++
    return `10.11.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
  }
  function newEmail() {
    const email = `${crypto.randomUUID()}@example.com`
    emails.push(email)
    return email
  }

  function setup(options: { turnstile?: boolean; allowlist?: string[] } = {}) {
    const env = resolveAuthEnv({})
    const mails: Mail[] = []
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
      verifyTurnstile: async ({ token }) => (options.turnstile ?? true) && token === "ok",
      recipientAllowlist: options.allowlist ? new Set(options.allowlist) : undefined,
      now: () => new Date(clock),
    })
    const headers = (ip: string, extra: Record<string, string> = {}) =>
      new Headers({ "x-real-ip": ip, "x-turnstile-token": "ok", ...extra })

    async function send(email: string, ip: string, extra: Record<string, string> = {}) {
      return auth.handler(
        new Request(`${BASE}/api/auth${server.SEND_OTP_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...Object.fromEntries(headers(ip, extra)) },
          body: JSON.stringify({ email, type: "sign-in" }),
        })
      )
    }
    async function signIn(email: string, otp: string, ip: string, body: Record<string, unknown> = {}) {
      return auth.handler(
        new Request(`${BASE}/api/auth${server.SIGN_IN_OTP_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": ip },
          body: JSON.stringify({ email, otp, ...body }),
        })
      )
    }
    /** rate limit をかけずに送る（hooks は動く） */
    async function apiSend(email: string, ip: string) {
      return auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: headers(ip) })
    }
    async function apiSignIn(email: string, otp: string, ip: string) {
      return auth.api
        .signInEmailOTP({ body: { email, otp }, headers: new Headers({ "x-real-ip": ip }) })
        .then(() => "ok" as const)
        .catch((e: { body?: { code?: string } }) => e.body?.code ?? "error")
    }
    const lastOtp = (email: string) => [...mails].reverse().find((m) => m.to === email)?.otp
    const advance = (ms: number) => {
      clock += ms
    }
    return { auth, mails, send, signIn, apiSend, apiSignIn, lastOtp, advance }
  }

  async function userByEmail(email: string) {
    const [user] = await db.select().from(schema.users).where(drizzle.eq(schema.users.email, email))
    return user
  }

  async function wrongOtp(otp: string) {
    return otp === "000000" ? "111111" : "000000"
  }

  describe("2.1 ログインと、コードの期限・試行・使い回し", () => {
    it("届いたコードを入力するとログインできる", async () => {
      const t = setup()
      const email = newEmail()
      const id = crypto.randomUUID()
      userIds.push(id)
      await db.insert(schema.users).values({ id, email, name: "花子", emailVerifiedFlag: true })
      const ip = newIp()

      const sent = await t.send(email, ip)
      expect(sent.status).toBe(200)
      expect(t.mails).toHaveLength(1)

      const res = await t.signIn(email, t.lastOtp(email)!, ip)
      expect(res.status).toBe(200)
      expect(res.headers.get("set-cookie")).toMatch(/better-auth\.session_token=/)
      const body = await res.json()
      expect(body.user.id).toBe(id)
      const sessions = await db.select().from(schema.authSessions).where(drizzle.eq(schema.authSessions.userId, id))
      expect(sessions).toHaveLength(1)
    })

    it("未登録のアドレスはコードの照合でユーザーが作られる", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.send(email, ip)
      const res = await t.signIn(email, t.lastOtp(email)!, ip)
      expect(res.status).toBe(200)

      const user = await userByEmail(email)
      expect(user).toMatchObject({ email, name: "", emailVerifiedFlag: true })
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it("コードを送っただけではユーザーは作られない", async () => {
      const t = setup()
      const email = newEmail()
      await t.send(email, newIp())
      expect(await userByEmail(email)).toBeUndefined()
    })

    it("ログインの本文の name・image は受け付けない", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.send(email, ip)
      await t.signIn(email, t.lastOtp(email)!, ip, { name: "なりすまし", image: "https://evil.example.com/a.png" })
      expect(await userByEmail(email)).toMatchObject({ name: "", image: null })
    })

    it("5 分を過ぎたコードではログインできない", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      expect(await t.apiSend(email, ip)).toEqual({ success: true })
      expect(t.lastOtp(email)).toBeDefined()
      await db
        .update(schema.authVerifications)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(drizzle.eq(schema.authVerifications.identifier, `sign-in-otp-${email}`))

      const res = await t.signIn(email, t.lastOtp(email)!, ip)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("OTP_EXPIRED")
    })

    it("まちがったコードには不一致の文言を出す", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.send(email, ip)
      const res = await t.signIn(email, await wrongOtp(t.lastOtp(email)!), ip)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("INVALID_OTP")
    })

    it("3 回まちがえるとコードが無効になる", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.apiSend(email, ip)
      const otp = t.lastOtp(email)!
      for (let i = 0; i < 3; i++) expect(await t.apiSignIn(email, await wrongOtp(otp), ip)).toBe("INVALID_OTP")
      expect(await t.apiSignIn(email, otp, ip)).toBe("TOO_MANY_ATTEMPTS")
    })

    it("再送するとコードを送り直してログインできる", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.apiSend(email, ip)
      const first = t.lastOtp(email)!
      for (let i = 0; i < 3; i++) await t.apiSignIn(email, await wrongOtp(first), ip)

      t.advance(61 * 1000)
      await t.apiSend(email, ip)
      expect(t.mails).toHaveLength(2)
      expect(await t.apiSignIn(email, t.lastOtp(email)!, ip)).toBe("ok")
    })

    it("使ったコードではもう一度ログインできない", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.apiSend(email, ip)
      const otp = t.lastOtp(email)!
      expect(await t.apiSignIn(email, otp, ip)).toBe("ok")
      // 使ったコードの行は消えているので、期限切れと同じ応答（再送信を促す）
      expect(await t.apiSignIn(email, otp, ip)).toBe("OTP_EXPIRED")
    })

    it("期限切れのコードの行がほかのリクエストの掃除で消えていても、期限切れの文言になる", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.apiSend(email, ip)
      await db
        .delete(schema.authVerifications)
        .where(drizzle.eq(schema.authVerifications.identifier, `sign-in-otp-${email}`))
      expect(await t.apiSignIn(email, t.lastOtp(email)!, ip)).toBe("OTP_EXPIRED")
    })

    it("コードを送っていないアドレスの照合は、照合として数えずに期限切れと同じ応答", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      expect(await t.apiSignIn(email, "123456", ip)).toBe("OTP_EXPIRED")
      const repo = new Repo(db, resolveAuthEnv({}).otpEventHmacKey)
      const rows = await db
        .select()
        .from(schema.otpEvents)
        .where(drizzle.eq(schema.otpEvents.emailHash, repo.hashEmail(email)))
      expect(rows).toHaveLength(0)
    })

    it("新しいコードを送ると古いコードは使えない", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.apiSend(email, ip)
      const first = t.lastOtp(email)!
      t.advance(61 * 1000)
      await t.apiSend(email, ip)
      const second = t.lastOtp(email)!
      if (first !== second) expect(await t.apiSignIn(email, first, ip)).toBe("INVALID_OTP")
      expect(await t.apiSignIn(email, second, ip)).toBe("ok")
    })

    it("DB には平文のコードが残らない", async () => {
      const t = setup()
      const email = newEmail()
      await t.apiSend(email, newIp())
      const otp = t.lastOtp(email)!
      const rows = await db
        .select()
        .from(schema.authVerifications)
        .where(drizzle.eq(schema.authVerifications.identifier, `sign-in-otp-${email}`))
      expect(rows).toHaveLength(1)
      expect(rows[0].value).not.toContain(otp)
      expect(rows[0].value.split(":")[0]).toBe(await server.createOtpHasher(resolveAuthEnv({}).secret)(otp))
    })

    it("大文字や前後の空白があっても同じユーザーになる", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.apiSend(` ${email.toUpperCase()} `, ip)
      expect(t.mails.at(-1)?.to).toBe(email)
      expect(await t.apiSignIn(email.toUpperCase(), t.lastOtp(email)!, ip)).toBe("ok")
      const users = await db.select().from(schema.users).where(drizzle.eq(schema.users.email, email))
      expect(users).toHaveLength(1)
    })

    it("正規化の後も ASCII 以外が残るアドレスは受け付けない", async () => {
      const t = setup()
      const res = await t.send("たろう@example.com", newIp())
      expect(res.status).toBe(400)
      expect(t.mails).toHaveLength(0)
    })

    it("ログイン以外の種類のコードの送信は断る", async () => {
      const t = setup()
      const email = newEmail()
      const res = await t.auth.handler(
        new Request(`${BASE}/api/auth${server.SEND_OTP_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": newIp(), "x-turnstile-token": "ok" },
          body: JSON.stringify({ email, type: "forget-password" }),
        })
      )
      expect(res.status).toBe(400)
      expect(t.mails).toHaveLength(0)
    })
  })

  describe("2.2 アドレスに結びつく上限と、黙って送らないとき", () => {
    it("60 秒以内に同じアドレスに送っても 2 通目は送られない", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await t.apiSend(email, ip)
      const first = t.lastOtp(email)!
      t.advance(30 * 1000)
      await t.apiSend(email, ip)
      expect(t.mails).toHaveLength(1)
      expect(await t.apiSignIn(email, first, ip)).toBe("ok")
    })

    it("上限で見送った送信では本人の手元のコードが使える", async () => {
      const t = setup()
      const email = newEmail()
      const family = newIp()
      await t.apiSend(email, family)
      const otp = t.lastOtp(email)!
      t.advance(10 * 1000)
      expect(await t.apiSend(email, newIp())).toEqual({ success: true })
      expect(t.mails).toHaveLength(1)
      expect(await t.apiSignIn(email, otp, family)).toBe("ok")
    })

    it("同じアドレス × IP の 6 通目は送られない", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      for (let i = 0; i < 6; i++) {
        expect(await t.apiSend(email, ip)).toEqual({ success: true })
        t.advance(61 * 1000)
      }
      expect(t.mails).toHaveLength(5)
    })

    it("別の IP からは同じアドレスに送れる", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      for (let i = 0; i < 5; i++) {
        await t.apiSend(email, ip)
        t.advance(61 * 1000)
      }
      await t.apiSend(email, newIp())
      expect(t.mails).toHaveLength(6)
    })

    async function failTenTimes(t: ReturnType<typeof setup>, email: string, ip: string) {
      for (let round = 0; round < 4; round++) {
        await t.apiSend(email, ip)
        const otp = t.lastOtp(email)!
        for (let i = 0; i < 3 && round * 3 + i < 10; i++) await t.apiSignIn(email, await wrongOtp(otp), ip)
        t.advance(61 * 1000)
      }
    }

    it("失敗が 10 回に達するとその IP からはログインできない", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await failTenTimes(t, email, ip)
      const before = t.mails.length
      await t.apiSend(email, ip)
      // ロック中はコードも送らない（黙って見送る）
      expect(t.mails).toHaveLength(before)
      expect(await t.apiSignIn(email, t.lastOtp(email)!, ip)).toBe("OTP_LOCKED")
    })

    it("ロック中でも別の IP からはログインできる", async () => {
      const t = setup()
      const email = newEmail()
      const ip = newIp()
      await failTenTimes(t, email, ip)
      const other = newIp()
      await t.apiSend(email, other)
      expect(await t.apiSignIn(email, t.lastOtp(email)!, other)).toBe("ok")
    })

    it("登録済みと未登録で応答が同じ", async () => {
      const t = setup()
      const registered = newEmail()
      const id = crypto.randomUUID()
      userIds.push(id)
      await db.insert(schema.users).values({ id, email: registered, name: "太郎", emailVerifiedFlag: true })

      const a = await t.send(registered, newIp())
      const b = await t.send(newEmail(), newIp())
      expect([a.status, await a.text()]).toEqual([b.status, await b.text()])
    })

    it("アドレスの上限やロックで見送っても応答が同じ", async () => {
      const t = setup()
      const normal = await t.send(newEmail(), newIp())
      const normalBody = await normal.text()

      // 「アドレス × IP」の上限
      const limited = newEmail()
      const ip = newIp()
      for (let i = 0; i < 5; i++) {
        await t.apiSend(limited, ip)
        t.advance(61 * 1000)
      }
      const res1 = await t.send(limited, ip)
      // ロック中
      const locked = newEmail()
      const lockedIp = newIp()
      await failTenTimes(t, locked, lockedIp)
      const lockedMails = t.mails.filter((m) => m.to === locked).length
      const res2 = await t.send(locked, lockedIp)

      for (const res of [res1, res2]) {
        expect(res.status).toBe(normal.status)
        expect(await res.text()).toBe(normalBody)
      }
      // どちらもメールは送られない
      expect(t.mails.filter((m) => m.to === limited)).toHaveLength(5)
      expect(t.mails.filter((m) => m.to === locked)).toHaveLength(lockedMails)
    })

    it("許可リストにないアドレスには送らない", async () => {
      const allowed = newEmail()
      const t = setup({ allowlist: [allowed] })
      const outside = newEmail()
      expect(await t.apiSend(outside, newIp())).toEqual({ success: true })
      await t.apiSend(allowed, newIp())
      expect(t.mails.map((m) => m.to)).toEqual([allowed])
      // 見送ったアドレスにはコードも作らない
      const rows = await db
        .select()
        .from(schema.authVerifications)
        .where(drizzle.eq(schema.authVerifications.identifier, `sign-in-otp-${outside}`))
      expect(rows).toHaveLength(0)
    })

    it("許可リストが未設定なら送信先を限らない", async () => {
      const t = setup()
      const a = newEmail()
      const b = newEmail()
      await t.apiSend(a, newIp())
      await t.apiSend(b, newIp())
      expect(t.mails.map((m) => m.to)).toEqual([a, b])
    })
  })

  describe("2.3 IP ごとの上限", () => {
    it("同じ IP から 1 分に 4 通目は送られない", async () => {
      const t = setup()
      const ip = newIp()
      const statuses = []
      for (let i = 0; i < 4; i++) statuses.push((await t.send(newEmail(), ip)).status)
      expect(statuses).toEqual([200, 200, 200, 429])
      expect(t.mails).toHaveLength(3)
    })

    it("同じ IP から 24 時間に 21 通目は送られない", async () => {
      const t = setup()
      const ip = newIp()
      const hmac = new Repo(db, resolveAuthEnv({}).otpEventHmacKey)
      // 1 分 3 通以下の間隔で 20 通送った後（記録を入れて再現する）
      const past = Array.from({ length: 20 }, (_, i) => {
        const email = newEmail()
        return {
          id: crypto.randomUUID(),
          emailHash: hmac.hashEmail(email),
          ip,
          kind: "sent",
          createdAt: new Date(Date.now() - (i + 1) * 30 * MIN),
        }
      })
      await db.insert(schema.otpEvents).values(past)
      const res = await t.send(newEmail(), ip)
      expect(res.status).toBe(429)
      expect(t.mails).toHaveLength(0)
    })

    it("同じ IP から 1 分に 11 回目の照合は断る", async () => {
      const t = setup()
      const ip = newIp()
      const statuses = []
      for (let i = 0; i < 11; i++) statuses.push((await t.signIn(newEmail(), "123456", ip)).status)
      expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true)
      expect(statuses[10]).toBe(429)
    })

    it("x-forwarded-for を変えても上限は変わらない", async () => {
      const t = setup()
      const ip = newIp()
      const statuses = []
      for (let i = 0; i < 4; i++) {
        statuses.push((await t.send(newEmail(), ip, { "x-forwarded-for": `198.51.100.${i + 1}` })).status)
      }
      expect(statuses).toEqual([200, 200, 200, 429])
    })

    it("同じ /64 の IPv6 は 1 つの IP として数える", async () => {
      const t = setup()
      const prefix = `2001:db8:${(ipSeq++ % 65535).toString(16)}:${Math.floor(Math.random() * 65535).toString(16)}`
      const statuses = []
      for (let i = 0; i < 4; i++) statuses.push((await t.send(newEmail(), `${prefix}::${i + 1}`)).status)
      expect(statuses).toEqual([200, 200, 200, 429])
    })
  })

  describe("2.4 Turnstile", () => {
    it("Turnstile の確認に失敗したら送らない", async () => {
      const t = setup({ turnstile: false })
      const res = await t.send(newEmail(), newIp())
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe("TURNSTILE_FAILED")
      expect(t.mails).toHaveLength(0)
    })

    it("Turnstile のトークンがなければ送らない", async () => {
      const t = setup()
      const res = await t.send(newEmail(), newIp(), { "x-turnstile-token": "" })
      expect(res.status).toBe(403)
      expect(t.mails).toHaveLength(0)
    })
  })

  describe("2.5 既存の Google ユーザーの紐付け", () => {
    it("Gmail のアドレスでログインすると前のデータが見える", async () => {
      const t = setup()
      const email = `${crypto.randomUUID().slice(0, 8)}.family@gmail.com`
      emails.push(email)
      const id = crypto.randomUUID()
      const groupId = crypto.randomUUID()
      userIds.push(id)
      // Google でログインして作られた行（A2 の expand で email_verified_flag は true、name あり）
      await db.insert(schema.users).values({
        id,
        email,
        name: "ママ",
        emailVerified: new Date("2026-01-01"),
        emailVerifiedFlag: true,
        image: "https://lh3.googleusercontent.com/a",
      })
      await db.insert(schema.accounts).values({
        userId: id,
        type: "oauth",
        provider: "google",
        providerAccountId: `google-${id}`,
      })
      await db.insert(schema.groups).values({ id: groupId, name: "家族", inviteCode: groupId.slice(0, 8).toUpperCase() })
      await db.insert(schema.groupMembers).values({ id: crypto.randomUUID(), groupId, userId: id, role: "owner" })
      await db.insert(schema.items).values({ id: crypto.randomUUID(), name: "牛乳", userId: id, groupId })

      const ip = newIp()
      await t.apiSend(email, ip)
      const res = await t.signIn(email, t.lastOtp(email)!, ip)
      expect(res.status).toBe(200)
      expect((await res.json()).user.id).toBe(id)

      // 同じ users の行のまま（名前・グループ・アイテムが残る）
      expect(await userByEmail(email)).toMatchObject({ id, name: "ママ" })
      const members = await db.select().from(schema.groupMembers).where(drizzle.eq(schema.groupMembers.userId, id))
      expect(members).toHaveLength(1)
      const items = await db.select().from(schema.items).where(drizzle.eq(schema.items.userId, id))
      expect(items.map((i) => i.name)).toEqual(["牛乳"])

      await db.delete(schema.groups).where(drizzle.eq(schema.groups.id, groupId))
    })
  })
})
