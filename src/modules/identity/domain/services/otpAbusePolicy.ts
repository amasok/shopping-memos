/**
 * OTP の送信と照合の乱用対策の判定（#61 A3a。change 61-a3-email-otp-login の design の D4）
 *
 * 1 つのアドレスの記録（otp_events。全 IP 分、直近 24 時間以上）と今の時刻から、送ってよいか・照合に進めてよいかを決める純粋関数。
 * 呼ぶ側（OtpEventRepository）は、アドレスの advisory lock の中で「読む → 判定 → 進むときだけ記録する」の順に行う。
 * 同じアドレスのリクエストは直列になるので、同時の照合でも数えもれがない。照合として扱わなかったもの（断ったもの）は記録しない
 *
 * A3b（61-a3b-otp-abuse-escalation）で、チャレンジの段階と、ログインの成功でのロックの解除を足す
 */

export type OtpEventKind = "sent" | "attempted" | "locked" | "unlocked" | "notified" | "alerted"

export interface OtpEventRecord {
  kind: OtpEventKind
  /** IP のキー（取れないときは 'unknown'） */
  ip: string
  createdAt: Date
}

const SECOND = 1000
const HOUR = 60 * 60 * SECOND
const DAY = 24 * HOUR

export const OTP_POLICY = {
  /** 同じアドレスへの送信の間隔（IP によらない） */
  resendIntervalMs: 60 * SECOND,
  /** 同じ「アドレス × IP」への送信の上限（windowMs あたり） */
  sendsPerAddressIpPerWindow: 5,
  /** 1 つのコードの照合の上限（最後の sent の後の attempted。IP によらない） */
  attemptsPerCode: 3,
  /** 同じ「アドレス × IP」の照合がこの回数に達したらロックする（windowMs かつ最後の unlocked の後） */
  attemptsPerAddressIpBeforeLock: 10,
  lockDurationMs: DAY,
  /** 数える期間（直近 24 時間。暦日ではない） */
  windowMs: DAY,
  /** 記録の保持期間 */
  retentionMs: 30 * DAY,
} as const

export type SendDecision =
  | { kind: "send" }
  /** アドレスに結びついた理由で見送る。送ったときと同じ応答を返し、今のコードも変えない */
  | { kind: "silent"; reason: "resend-interval" | "address-ip-limit" | "locked" }

export type VerifyDecision =
  /** 照合に進む。locksAfter なら、この照合の記録の後に locked を記録する */
  | { kind: "verify"; locksAfter: boolean }
  /** 照合しない。code-attempts-exceeded は期限切れと同じ応答にする */
  | { kind: "reject"; reason: "locked" | "code-attempts-exceeded" }

function within(event: OtpEventRecord, now: Date, ms: number): boolean {
  return now.getTime() - event.createdAt.getTime() < ms
}

function latest(events: readonly OtpEventRecord[], kind: OtpEventKind): OtpEventRecord | undefined {
  let found: OtpEventRecord | undefined
  for (const e of events) {
    if (e.kind === kind && (!found || e.createdAt > found.createdAt)) found = e
  }
  return found
}

function isLocked(events: readonly OtpEventRecord[], ip: string, now: Date): boolean {
  return events.some((e) => e.kind === "locked" && e.ip === ip && within(e, now, OTP_POLICY.lockDurationMs))
}

/** 累積ロックに数える照合（同じ IP、直近 24 時間、最後の unlocked の後） */
function countAttemptsTowardLock(events: readonly OtpEventRecord[], ip: string, now: Date): number {
  const lastUnlocked = latest(events, "unlocked")
  return events.filter(
    (e) =>
      e.kind === "attempted" &&
      e.ip === ip &&
      within(e, now, OTP_POLICY.windowMs) &&
      (!lastUnlocked || e.createdAt > lastUnlocked.createdAt)
  ).length
}

export function decideSend(events: readonly OtpEventRecord[], ip: string, now: Date): SendDecision {
  const lastSent = latest(events, "sent")
  if (lastSent && within(lastSent, now, OTP_POLICY.resendIntervalMs)) {
    return { kind: "silent", reason: "resend-interval" }
  }
  if (isLocked(events, ip, now)) {
    return { kind: "silent", reason: "locked" }
  }
  const sentFromIp = events.filter(
    (e) => e.kind === "sent" && e.ip === ip && within(e, now, OTP_POLICY.windowMs)
  ).length
  if (sentFromIp >= OTP_POLICY.sendsPerAddressIpPerWindow) {
    return { kind: "silent", reason: "address-ip-limit" }
  }
  return { kind: "send" }
}

export function decideVerify(events: readonly OtpEventRecord[], ip: string, now: Date): VerifyDecision {
  const towardLock = countAttemptsTowardLock(events, ip, now)
  if (isLocked(events, ip, now) || towardLock >= OTP_POLICY.attemptsPerAddressIpBeforeLock) {
    return { kind: "reject", reason: "locked" }
  }

  const lastSent = latest(events, "sent")
  const attemptsOnCode = events.filter(
    (e) => e.kind === "attempted" && (!lastSent || e.createdAt > lastSent.createdAt)
  ).length
  if (attemptsOnCode >= OTP_POLICY.attemptsPerCode) {
    return { kind: "reject", reason: "code-attempts-exceeded" }
  }

  return { kind: "verify", locksAfter: towardLock + 1 >= OTP_POLICY.attemptsPerAddressIpBeforeLock }
}

/** 保持期間（30 日）を過ぎた記録か */
export function isExpiredOtpEvent(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > OTP_POLICY.retentionMs
}
