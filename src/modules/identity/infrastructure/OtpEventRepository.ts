import { createHmac, randomUUID } from "node:crypto"
import { and, desc, eq, gt, lt, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { normalizeEmail } from "@/shared/schemas/email"
import * as schema from "@/infrastructure/db/drizzle/schema"
import { otpEvents } from "@/infrastructure/db/drizzle/schema"
import {
  OTP_POLICY,
  decideSend,
  decideVerify,
  type OtpEventKind,
  type OtpEventRecord,
  type SendDecision,
  type VerifyDecision,
} from "../domain/services/otpAbusePolicy"

type Db = PostgresJsDatabase<typeof schema>
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

const DAY = 24 * 60 * 60 * 1000
/** 1 つのアドレスの直近 24 時間の記録の読み込みの上限（IP ごとの上限があるので、通常は数十件） */
const READ_LIMIT = 1000

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
      const events = await this.lockAndRead(tx, emailHash, now)
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
      const events = await this.lockAndRead(tx, emailHash, now)
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

  private async lockAndRead(tx: Tx, emailHash: string, now: Date): Promise<OtpEventRecord[]> {
    await this.lock(tx, emailHash)
    const since = new Date(now.getTime() - OTP_POLICY.windowMs)
    const rows = await tx
      .select({ kind: otpEvents.kind, ip: otpEvents.ip, createdAt: otpEvents.createdAt })
      .from(otpEvents)
      .where(and(eq(otpEvents.emailHash, emailHash), gt(otpEvents.createdAt, since)))
      .orderBy(desc(otpEvents.createdAt))
      .limit(READ_LIMIT)
    return rows.map((r) => ({ kind: r.kind as OtpEventKind, ip: r.ip, createdAt: r.createdAt }))
  }

  private async insert(tx: Tx, emailHash: string, ip: string, kind: OtpEventKind, now: Date): Promise<void> {
    await tx.insert(otpEvents).values({ id: randomUUID(), emailHash, ip, kind, createdAt: now })
  }
}
