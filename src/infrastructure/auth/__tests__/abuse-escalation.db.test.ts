// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * 狙われたアドレスへのチャレンジ・制限の通知と解除・送信数の監視（#61 A3b）を実 DB で確かめるテスト
 *
 * DB_TEST_URL があるときだけ流す（なければスキップ）。流し方: npm run test:db
 * Turnstile は、非表示のウィジェットのトークンを "ok"、対話型のウィジェットのトークンを "challenge-ok" として、
 * それぞれの secret でだけ通るように差し替える（チャレンジの段階では challenge が true で呼ばれる）
 */
const TEST_DB_URL = process.env.DB_TEST_URL

if (TEST_DB_URL && !["localhost", "127.0.0.1"].includes(new URL(TEST_DB_URL).hostname)) {
  throw new Error("DB_TEST_URL は localhost / 127.0.0.1 の DB だけ指定できます")
}

const BASE = "http://localhost:3000"
const MIN = 60 * 1000
const HOUR = 60 * MIN
const ADMIN = "otp-admin@example.com"

type Schema = typeof import("@/infrastructure/db/drizzle/schema")
type Notice = { to: string; kind: string }

describe.skipIf(!TEST_DB_URL)("狙われたアドレスへのチャレンジ・通知・監視（実 DB）", () => {
  let client: import("postgres").Sql
  let db: import("drizzle-orm/postgres-js").PostgresJsDatabase<Schema>
  let schema: Schema
  let drizzle: typeof import("drizzle-orm")
  let server: typeof import("../server")
  let Repo: typeof import("@/modules/identity/infrastructure/OtpEventRepository").OtpEventRepository
  let resolveAuthEnv: typeof import("../env").resolveAuthEnv
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
  /** ほかの db テストのファイル（10.11.*・10.12.*）と重ならない */
  function newIp() {
    ipSeq++
    return `10.13.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
  }
  function newEmail() {
    const email = `${crypto.randomUUID()}@example.com`
    emails.push(email)
    return email
  }
  async function register(email: string) {
    await db.insert(schema.users).values({ id: crypto.randomUUID(), email, name: "家族", emailVerifiedFlag: true })
  }

  function setup(options: { startAt?: number } = {}) {
    const env = resolveAuthEnv({})
    const repo = new Repo(db, env.otpEventHmacKey)
    const mails: { to: string; otp: string }[] = []
    const notices: Notice[] = []
    let clock = options.startAt ?? Date.now()
    const auth = server.createAuth({
      db,
      env,
      emailSender: {
        async sendOtp({ to, otp }) {
          mails.push({ to, otp })
        },
        async sendNotice({ to, notice }) {
          notices.push({ to, kind: notice.kind })
        },
      },
      otpEvents: repo,
      verifyTurnstile: async ({ token, challenge }) => (challenge ? token === "challenge-ok" : token === "ok"),
      alertEmail: ADMIN,
      now: () => new Date(clock),
    })

    async function apiSend(email: string, ip: string, token = "ok") {
      return auth.api
        .sendVerificationOTP({
          body: { email, type: "sign-in" },
          headers: new Headers({ "x-real-ip": ip, "x-turnstile-token": token }),
        })
        .then(() => "ok" as const)
        .catch((e: { body?: { code?: string } }) => e.body?.code ?? "error")
    }
    async function apiSignIn(email: string, otp: string, ip: string) {
      return auth.api
        .signInEmailOTP({ body: { email, otp }, headers: new Headers({ "x-real-ip": ip }) })
        .then(() => "ok" as const)
        .catch((e: { body?: { code?: string } }) => e.body?.code ?? "error")
    }
    async function send(email: string, ip: string, token = "ok") {
      return auth.handler(
        new Request(`${BASE}/api/auth${server.SEND_OTP_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": ip, "x-turnstile-token": token },
          body: JSON.stringify({ email, type: "sign-in" }),
        })
      )
    }
    const lastOtp = (email: string) => [...mails].reverse().find((m) => m.to === email)?.otp
    const advance = (ms: number) => {
      clock += ms
    }
    const now = () => clock

    /** 送り直しをはさみつつ、この IP から照合に 10 回失敗する（ロックされる） */
    async function failTenTimes(email: string, ip: string) {
      for (let round = 0; round < 4; round++) {
        await apiSend(email, ip)
        const otp = lastOtp(email)!
        const wrong = otp === "000000" ? "111111" : "000000"
        for (let i = 0; i < 3 && round * 3 + i < 10; i++) await apiSignIn(email, wrong, ip)
        advance(61 * 1000)
      }
    }

    /** 別々の IP から、このアドレスに送った（または照合に失敗した）記録を入れる（1 分ごと、最後は 2 分前） */
    async function seed(email: string, kind: "sent" | "attempted", count: number) {
      const rows = Array.from({ length: count }, (_, i) => ({
        id: crypto.randomUUID(),
        emailHash: repo.hashEmail(email),
        ip: `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`,
        kind,
        createdAt: new Date(clock - (count - i + 1) * MIN),
      }))
      await db.insert(schema.otpEvents).values(rows)
    }

    return { auth, repo, mails, notices, apiSend, apiSignIn, send, lastOtp, advance, now, failTenTimes, seed }
  }

  describe("狙われたアドレスへの対話型のチャレンジ", () => {
    it("送信が 20 通に達したアドレスは対話型のチャレンジが要る", async () => {
      const t = setup()
      const email = newEmail()
      await t.seed(email, "sent", 20)
      expect(await t.apiSend(email, newIp())).toBe("TURNSTILE_CHALLENGE_REQUIRED")
      expect(t.mails).toHaveLength(0)
    })

    it("対話型のチャレンジを通れば送れる", async () => {
      const t = setup()
      const email = newEmail()
      await t.seed(email, "sent", 20)
      expect(await t.apiSend(email, newIp(), "challenge-ok")).toBe("ok")
      expect(t.mails.map((m) => m.to)).toEqual([email])
    })

    it("チャレンジの段階では非表示のウィジェットのトークンを受け付けない", async () => {
      const t = setup()
      const email = newEmail()
      await t.seed(email, "sent", 20)
      // "ok" は非表示のウィジェットの secret でなら通るトークン
      expect(await t.apiSend(email, newIp(), "ok")).not.toBe("ok")
      expect(t.mails).toHaveLength(0)
    })

    it("失敗が 30 回に達したアドレスも対話型のチャレンジが要る", async () => {
      const t = setup()
      const email = newEmail()
      await t.seed(email, "attempted", 30)
      expect(await t.apiSend(email, newIp())).toBe("TURNSTILE_CHALLENGE_REQUIRED")
      expect(t.mails).toHaveLength(0)
    })

    it("失敗が 29 回、送信が 19 通ならチャレンジは要らない", async () => {
      const t = setup()
      const a = newEmail()
      const b = newEmail()
      await t.seed(a, "attempted", 29)
      await t.seed(b, "sent", 19)
      expect(await t.apiSend(a, newIp())).toBe("ok")
      expect(await t.apiSend(b, newIp())).toBe("ok")
    })

    it("未登録のアドレスでも送信が 20 通でチャレンジが要る（応答は登録済みのアドレスと同じ）", async () => {
      const t = setup()
      const registered = newEmail()
      const unregistered = newEmail()
      await register(registered)
      await t.seed(registered, "sent", 20)
      await t.seed(unregistered, "sent", 20)
      const a = await t.send(registered, newIp())
      const b = await t.send(unregistered, newIp())
      expect(a.status).toBe(403)
      expect([a.status, await a.text()]).toEqual([b.status, await b.text()])
      expect(t.mails).toHaveLength(0)
    })

    it("ログインに成功しても、送信の数によるチャレンジは解けない（送信の枠を守る）", async () => {
      const t = setup()
      const email = newEmail()
      await t.seed(email, "sent", 20)
      const ip = newIp()
      expect(await t.apiSend(email, ip, "challenge-ok")).toBe("ok")
      expect(await t.apiSignIn(email, t.lastOtp(email)!, ip)).toBe("ok")
      t.advance(61 * 1000)
      expect(await t.apiSend(email, newIp())).toBe("TURNSTILE_CHALLENGE_REQUIRED")
    })

    it("ログインに成功すると、失敗の数によるチャレンジは解ける", async () => {
      const t = setup()
      const email = newEmail()
      await t.seed(email, "attempted", 30)
      const ip = newIp()
      expect(await t.apiSend(email, ip, "challenge-ok")).toBe("ok")
      expect(await t.apiSignIn(email, t.lastOtp(email)!, ip)).toBe("ok")
      t.advance(61 * 1000)
      expect(await t.apiSend(email, newIp())).toBe("ok")
    })
  })

  describe("制限の通知と解除", () => {
    it("ロックされると本人に 1 通だけ知らせる", async () => {
      const t = setup()
      const email = newEmail()
      await register(email)
      await t.failTenTimes(email, newIp())
      await t.failTenTimes(email, newIp())
      expect(t.notices).toEqual([{ to: email, kind: "otp-locked" }])
    })

    it("未登録のアドレスには通知を送らない", async () => {
      const t = setup()
      const email = newEmail()
      await t.failTenTimes(email, newIp())
      expect(t.notices).toEqual([])
    })

    it("チャレンジの段階に入ったときも通知する", async () => {
      const t = setup()
      const email = newEmail()
      await register(email)
      await t.seed(email, "sent", 20)
      expect(await t.apiSend(email, newIp())).toBe("TURNSTILE_CHALLENGE_REQUIRED")
      expect(t.notices).toEqual([{ to: email, kind: "otp-locked" }])
    })

    it("ロックとチャレンジが同じ 24 時間に重なっても、通知は 1 通だけ", async () => {
      const t = setup()
      const email = newEmail()
      await register(email)
      await t.failTenTimes(email, newIp())
      await t.seed(email, "sent", 20)
      expect(await t.apiSend(email, newIp())).toBe("TURNSTILE_CHALLENGE_REQUIRED")
      expect(t.notices).toHaveLength(1)
    })

    it("別の IP からログインするとロックが解ける", async () => {
      const t = setup()
      const email = newEmail()
      await register(email)
      const attacked = newIp()
      await t.failTenTimes(email, attacked)
      expect(await t.apiSignIn(email, "123456", attacked)).toBe("OTP_LOCKED")

      // 本人が別の IP からログインする
      const home = newIp()
      t.advance(61 * 1000)
      expect(await t.apiSend(email, home)).toBe("ok")
      expect(await t.apiSignIn(email, t.lastOtp(email)!, home)).toBe("ok")

      // ロックされていた IP からも、新しく送ったコードでログインできる
      t.advance(61 * 1000)
      expect(await t.apiSend(email, attacked)).toBe("ok")
      expect(await t.apiSignIn(email, t.lastOtp(email)!, attacked)).toBe("ok")
    })
  })

  describe("送信数の監視", () => {
    it("70 通を超えたら管理者に 1 回だけ知らせる", async () => {
      // 並列のほかのテストの送信を数えないよう、2 日先の時計で流す（30 日の掃除にも当たらない）
      const t = setup({ startAt: Date.now() + 2 * 24 * HOUR })
      const filler = Array.from({ length: 70 }, (_, i) => ({
        id: crypto.randomUUID(),
        emailHash: t.repo.hashEmail(newEmail()),
        ip: "unknown",
        kind: "sent",
        createdAt: new Date(t.now() - (70 - i) * MIN),
      }))
      await db.insert(schema.otpEvents).values(filler)

      // 71 通目と 72 通目
      expect(await t.apiSend(newEmail(), newIp())).toBe("ok")
      expect(await t.apiSend(newEmail(), newIp())).toBe("ok")
      expect(t.notices.filter((n) => n.to === ADMIN)).toEqual([{ to: ADMIN, kind: "otp-alert" }])

      const alerted = await db
        .select()
        .from(schema.otpEvents)
        .where(
          drizzle.and(
            drizzle.eq(schema.otpEvents.kind, "alerted"),
            drizzle.gt(schema.otpEvents.createdAt, new Date(t.now() - HOUR)),
            drizzle.lte(schema.otpEvents.createdAt, new Date(t.now()))
          )
        )
      expect(alerted).toHaveLength(1)
      expect(alerted[0].emailHash).toBeNull()
    })
  })
})
