import { createHmac, randomUUID } from "node:crypto"
import { and, count, desc, eq, gt, isNull, lt, lte, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { normalizeEmail } from "@/shared/schemas/email"
import * as schema from "@/infrastructure/db/drizzle/schema"
import { otpEvents, users } from "@/infrastructure/db/drizzle/schema"
import {
  OTP_POLICY,
  decideSend,
  decideVerify,
  shouldAlert,
  shouldNotify,
  type AddressCounts,
  type OtpEventKind,
  type OtpEventRecord,
  type SendDecision,
  type VerifyDecision,
} from "../domain/services/otpAbusePolicy"

type Db = PostgresJsDatabase<typeof schema>
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

const DAY = 24 * 60 * 60 * 1000
/** IP に結びつかない記録（notified・alerted）の ip */
const UNKNOWN_IP_KEY = "unknown"
/**
 * 1 つの「アドレス × IP」の直近 24 時間の記録の読み込みの上限。IP ごとの上限（送信 5 通・照合 10 回でロック）があるので、
 * 通常は数十件。アドレス全体の行は読まない（別の IP の行を積まれても、この IP の locked が読み込みから落ちないように）
 */
const READ_LIMIT_PER_IP = 500
/** 最新の sent の後の attempted（1 つのコードの 3 回の判定用。ロックの中で記録するので 3 件を超えない） */
const READ_LIMIT_ATTEMPTS_ON_CODE = 100

/**
 * otp_events の読み書き（#61 A3a 1.3。design の D2・D4）
 *
 * - アドレスは OTP_EVENT_HMAC_KEY を鍵にした HMAC-SHA256 で持ち、平文は残さない
 * - 判定は、アドレスの advisory lock（トランザクションの間）の中で「読む → otpAbusePolicy で判定 → 進むときだけ記録する」の順に行う。
 *   同じアドレスのリクエストは直列になるので、同時の送信・照合でも数えもれがない
 * - 30 日より古い記録は、送信の記録のついでに、プロセスごとに 1 日 1 回まとめて消す（定期ジョブを足さない）
 */
export class OtpEventRepository {
  private lastPurgedAt = 0

  constructor(
    private readonly db: Db,
    private readonly hmacKey: string
  ) {
    if (!hmacKey) throw new Error("OTP_EVENT_HMAC_KEY がありません")
  }

  /**
   * 正規化済みのアドレスの HMAC-SHA256（hex）。
   * 正規化していないアドレスは例外にする（大文字・空白の違いで別のキーになり、上限をすり抜けないように）
   */
  hashEmail(email: string): string {
    if (normalizeEmail(email) !== email) {
      throw new Error("otp_events には正規化したメールアドレスを渡してください")
    }
    return createHmac("sha256", this.hmacKey).update(email).digest("hex")
  }

  /** 送ってよいかを決め、送るなら sent を記録する */
  async guardSend(email: string, ip: string, now: Date = new Date()): Promise<SendDecision> {
    const emailHash = this.hashEmail(email)
    const decision = await this.db.transaction(async (tx) => {
      const events = await this.lockAndRead(tx, emailHash, ip, now)
      const result = decideSend(events, ip, now)
      if (result.kind === "send") await this.insert(tx, emailHash, ip, "sent", now)
      return result
    })
    await this.purgeExpiredOncePerDay(now)
    return decision
  }

  /** 照合に進めてよいかを決め、進むなら attempted を（10 回目なら locked も）記録する */
  async guardVerify(email: string, ip: string, now: Date = new Date()): Promise<VerifyDecision> {
    const emailHash = this.hashEmail(email)
    return this.db.transaction(async (tx) => {
      const events = await this.lockAndRead(tx, emailHash, ip, now)
      const result = decideVerify(events, ip, now)
      if (result.kind === "verify") {
        await this.insert(tx, emailHash, ip, "attempted", now)
        if (result.locksAfter) await this.insert(tx, emailHash, ip, "locked", now)
      }
      return result
    })
  }

  /** ログインに成功した（それより前の照合を累積ロックに数えない） */
  async recordUnlocked(email: string, ip: string, now: Date = new Date()): Promise<void> {
    const emailHash = this.hashEmail(email)
    await this.db.transaction(async (tx) => {
      await this.lock(tx, emailHash)
      await this.insert(tx, emailHash, ip, "unlocked", now)
    })
  }

  /**
   * アドレス全体（IP を問わない）の数（A3b のチャレンジの判定）。登録の有無は見ない
   * - sentLast24h: 直近 24 時間の sent（unlocked で区切らない）
   * - failuresSinceUnlockLast24h: 直近 24 時間かつ最後の unlocked の後の attempted
   */
  async addressCounts(email: string, now: Date = new Date()): Promise<AddressCounts> {
    const emailHash = this.hashEmail(email)
    const since = new Date(now.getTime() - OTP_POLICY.windowMs)
    const ofAddress = eq(otpEvents.emailHash, emailHash)
    const [lastUnlocked] = await this.db
      .select({ createdAt: otpEvents.createdAt })
      .from(otpEvents)
      .where(and(ofAddress, eq(otpEvents.kind, "unlocked")))
      .orderBy(desc(otpEvents.createdAt))
      .limit(1)
    const failuresSince = lastUnlocked && lastUnlocked.createdAt > since ? lastUnlocked.createdAt : since
    const [sent] = await this.db
      .select({ n: count() })
      .from(otpEvents)
      .where(and(ofAddress, eq(otpEvents.kind, "sent"), gt(otpEvents.createdAt, since)))
    const [failures] = await this.db
      .select({ n: count() })
      .from(otpEvents)
      .where(and(ofAddress, eq(otpEvents.kind, "attempted"), gt(otpEvents.createdAt, failuresSince)))
    return { sentLast24h: sent?.n ?? 0, failuresSinceUnlockLast24h: failures?.n ?? 0 }
  }

  /**
   * 本人への制限の通知を送るなら notified を記録して true を返す（A3b）。
   * 登録済みのアドレスだけ、直近 24 時間に 1 通まで。アドレスの advisory lock の中で判定するので、同時でも 1 通
   */
  async notifyOnce(email: string, now: Date = new Date()): Promise<boolean> {
    const emailHash = this.hashEmail(email)
    return this.db.transaction(async (tx) => {
      await this.lock(tx, emailHash)
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      const [last] = await tx
        .select({ createdAt: otpEvents.createdAt })
        .from(otpEvents)
        .where(and(eq(otpEvents.emailHash, emailHash), eq(otpEvents.kind, "notified")))
        .orderBy(desc(otpEvents.createdAt))
        .limit(1)
      if (!shouldNotify({ registered: !!user, lastNotifiedAt: last?.createdAt, now })) return false
      await this.insert(tx, emailHash, UNKNOWN_IP_KEY, "notified", now)
      return true
    })
  }

  /**
   * 送信数の監視（A3b）。直近 24 時間の送信が 70 通を超え、直近 24 時間に知らせていなければ、alerted を記録して
   * { alert: true } を返す。固定のキーの advisory lock の中で判定するので、同時の送信でも 1 回だけ
   */
  async checkAlert(now: Date = new Date()): Promise<{ alert: boolean; sentLast24h: number }> {
    const since = new Date(now.getTime() - OTP_POLICY.windowMs)
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('otp-events:alert', 0))`)
      const [sent] = await tx
        .select({ n: count() })
        .from(otpEvents)
        .where(and(eq(otpEvents.kind, "sent"), gt(otpEvents.createdAt, since), lte(otpEvents.createdAt, now)))
      const sentLast24h = sent?.n ?? 0
      const [last] = await tx
        .select({ createdAt: otpEvents.createdAt })
        .from(otpEvents)
        // 判定の時刻より後の行は見ない（本番ではない。テストで時計を進めたときに混ざらないように）
        .where(and(eq(otpEvents.kind, "alerted"), isNull(otpEvents.emailHash), lte(otpEvents.createdAt, now)))
        .orderBy(desc(otpEvents.createdAt))
        .limit(1)
      if (!shouldAlert({ sentLast24h, lastAlertedAt: last?.createdAt, now })) return { alert: false, sentLast24h }
      await tx
        .insert(otpEvents)
        .values({ id: randomUUID(), emailHash: null, ip: UNKNOWN_IP_KEY, kind: "alerted", createdAt: now })
      return { alert: true, sentLast24h }
    })
  }

  /** 保持期間（30 日）を過ぎた記録を消す。消した件数を返す */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - OTP_POLICY.retentionMs)
    const deleted = await this.db
      .delete(otpEvents)
      .where(lt(otpEvents.createdAt, cutoff))
      .returning({ id: otpEvents.id })
    return deleted.length
  }

  private async purgeExpiredOncePerDay(now: Date): Promise<void> {
    if (now.getTime() - this.lastPurgedAt < DAY) return
    this.lastPurgedAt = now.getTime()
    try {
      await this.purgeExpired(now)
    } catch (error) {
      // 掃除に失敗しても送信は止めない（次の日にまた試す）
      console.error("[otp-events] 古い記録の削除に失敗しました", error)
    }
  }

  private async lock(tx: Tx, emailHash: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`otp-events:${emailHash}`}, 0))`)
  }

  /**
   * 判定に要る記録だけを読む（otpAbusePolicy が見るのは次の 3 つ）
   * - この IP の直近 24 時間の行（ロック・「アドレス × IP」の送信の数・累積ロックの数）
   * - アドレスの最新の sent と最新の unlocked（再送の間隔・数え直しの区切り）
   * - 最新の sent の後の attempted（1 つのコードの 3 回。IP によらない）
   */
  private async lockAndRead(tx: Tx, emailHash: string, ip: string, now: Date): Promise<OtpEventRecord[]> {
    await this.lock(tx, emailHash)
    const since = new Date(now.getTime() - OTP_POLICY.windowMs)
    const columns = { id: otpEvents.id, kind: otpEvents.kind, ip: otpEvents.ip, createdAt: otpEvents.createdAt }
    const ofAddress = eq(otpEvents.emailHash, emailHash)

    const fromIp = await tx
      .select(columns)
      .from(otpEvents)
      .where(and(ofAddress, eq(otpEvents.ip, ip), gt(otpEvents.createdAt, since)))
      .orderBy(desc(otpEvents.createdAt))
      .limit(READ_LIMIT_PER_IP)
    const latestOf = async (kind: OtpEventKind) =>
      tx
        .select(columns)
        .from(otpEvents)
        .where(and(ofAddress, eq(otpEvents.kind, kind)))
        .orderBy(desc(otpEvents.createdAt))
        .limit(1)
    const lastSent = await latestOf("sent")
    const lastUnlocked = await latestOf("unlocked")
    const attemptsOnCode = await tx
      .select(columns)
      .from(otpEvents)
      .where(
        and(
          ofAddress,
          eq(otpEvents.kind, "attempted"),
          gt(otpEvents.createdAt, lastSent[0]?.createdAt ?? since)
        )
      )
      .orderBy(desc(otpEvents.createdAt))
      .limit(READ_LIMIT_ATTEMPTS_ON_CODE)

    const byId = new Map<string, OtpEventRecord>()
    for (const r of [...fromIp, ...lastSent, ...lastUnlocked, ...attemptsOnCode]) {
      byId.set(r.id, { kind: r.kind as OtpEventKind, ip: r.ip, createdAt: r.createdAt })
    }
    return [...byId.values()]
  }

  private async insert(tx: Tx, emailHash: string, ip: string, kind: OtpEventKind, now: Date): Promise<void> {
    await tx.insert(otpEvents).values({ id: randomUUID(), emailHash, ip, kind, createdAt: now })
  }
}
