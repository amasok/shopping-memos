import { describe, it, expect } from "vitest"
import {
  OTP_POLICY,
  decideSend,
  decideVerify,
  isExpiredOtpEvent,
  requiresChallenge,
  shouldAlert,
  shouldNotify,
  type OtpEventRecord,
} from "../otpAbusePolicy"

const NOW = new Date("2026-11-18T12:00:00Z")
const IP = "203.0.113.1"
const OTHER_IP = "198.51.100.7"

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

function ev(kind: OtpEventRecord["kind"], msAgo: number, ip = IP): OtpEventRecord {
  return { kind, ip, createdAt: ago(msAgo) }
}

describe("otpAbusePolicy: 送信（#61 A3a）", () => {
  it("記録がなければ送る", () => {
    expect(decideSend([], IP, NOW)).toEqual({ kind: "send" })
  })

  it("60 秒以内に同じアドレスへ送っていれば、別の IP からでも黙って送らない（再送の間隔）", () => {
    expect(decideSend([ev("sent", 59 * SEC, OTHER_IP)], IP, NOW)).toEqual({
      kind: "silent",
      reason: "resend-interval",
    })
  })

  it("最後の送信から 60 秒たてば送る", () => {
    expect(decideSend([ev("sent", 60 * SEC)], IP, NOW)).toEqual({ kind: "send" })
  })

  it("同じアドレス × IP で 24 時間に 5 通送っていれば、6 通目は黙って送らない", () => {
    const events = [1, 2, 3, 4, 5].map((h) => ev("sent", h * HOUR))
    expect(decideSend(events, IP, NOW)).toEqual({ kind: "silent", reason: "address-ip-limit" })
  })

  it("同じアドレスでも、別の IP からは送れる", () => {
    const events = [1, 2, 3, 4, 5].map((h) => ev("sent", h * HOUR))
    expect(decideSend(events, OTHER_IP, NOW)).toEqual({ kind: "send" })
  })

  it("24 時間より前の送信は数えない", () => {
    const events = [1, 2, 3, 4].map((h) => ev("sent", h * HOUR)).concat(ev("sent", 24 * HOUR + SEC))
    expect(decideSend(events, IP, NOW)).toEqual({ kind: "send" })
  })

  it("その アドレス × IP がロック中なら黙って送らない", () => {
    expect(decideSend([ev("locked", 2 * HOUR)], IP, NOW)).toEqual({ kind: "silent", reason: "locked" })
  })

  it("ロックは別の IP の送信を止めない", () => {
    expect(decideSend([ev("locked", 2 * HOUR)], OTHER_IP, NOW)).toEqual({ kind: "send" })
  })

  it("ロックから 24 時間たてば送る", () => {
    expect(decideSend([ev("locked", 24 * HOUR)], IP, NOW)).toEqual({ kind: "send" })
  })
})

describe("otpAbusePolicy: 照合（#61 A3a）", () => {
  it("記録がなければ照合に進む", () => {
    expect(decideVerify([ev("sent", MIN)], IP, NOW)).toEqual({ kind: "verify", locksAfter: false })
  })

  it("最後の送信の後に 3 回照合していれば、4 回目は期限切れと同じに断る（1 つのコードの 3 回）", () => {
    const events = [ev("sent", 4 * MIN), ev("attempted", 3 * MIN), ev("attempted", 2 * MIN), ev("attempted", MIN)]
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "reject", reason: "code-attempts-exceeded" })
  })

  it("1 つのコードの回数は、別の IP からの照合も合わせて数える", () => {
    const events = [
      ev("sent", 4 * MIN),
      ev("attempted", 3 * MIN, OTHER_IP),
      ev("attempted", 2 * MIN, OTHER_IP),
      ev("attempted", MIN),
    ]
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "reject", reason: "code-attempts-exceeded" })
  })

  it("送り直すと、1 つのコードの回数は新しいコードから数える", () => {
    const events = [
      ev("sent", 10 * MIN),
      ev("attempted", 9 * MIN),
      ev("attempted", 8 * MIN),
      ev("attempted", 7 * MIN),
      ev("sent", 2 * MIN),
    ]
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "verify", locksAfter: false })
  })

  it("同じアドレス × IP の照合が 24 時間に 9 回あれば、10 回目は照合に進み、その後ロックする", () => {
    // 送り直しをはさんで 9 回（1 つのコードの 3 回には当たらない）
    const events: OtpEventRecord[] = []
    for (let i = 0; i < 3; i++) {
      const base = (10 - i * 3) * HOUR
      events.push(ev("sent", base), ev("attempted", base - MIN), ev("attempted", base - 2 * MIN), ev("attempted", base - 3 * MIN))
    }
    events.push(ev("sent", MIN))
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "verify", locksAfter: true })
  })

  it("ロック中のアドレス × IP は照合しない", () => {
    expect(decideVerify([ev("locked", HOUR), ev("sent", MIN)], IP, NOW)).toEqual({
      kind: "reject",
      reason: "locked",
    })
  })

  it("ロック中でも、別の IP からは照合に進む", () => {
    expect(decideVerify([ev("locked", HOUR), ev("sent", MIN, OTHER_IP)], OTHER_IP, NOW)).toEqual({
      kind: "verify",
      locksAfter: false,
    })
  })

  it("ロックは 24 時間で解ける", () => {
    expect(decideVerify([ev("locked", 24 * HOUR), ev("sent", MIN)], IP, NOW)).toEqual({
      kind: "verify",
      locksAfter: false,
    })
  })

  it("最後の unlocked（ログインの成功）より前の照合は、累積ロックに数えない", () => {
    const events: OtpEventRecord[] = []
    for (let i = 0; i < 9; i++) events.push(ev("sent", (20 - i) * HOUR), ev("attempted", (20 - i) * HOUR - MIN))
    events.push(ev("unlocked", 5 * HOUR, OTHER_IP), ev("sent", MIN))
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "verify", locksAfter: false })
  })

  it("24 時間より前の照合は、累積ロックに数えない", () => {
    const events: OtpEventRecord[] = []
    for (let i = 0; i < 9; i++) events.push(ev("sent", (30 - i) * HOUR), ev("attempted", (30 - i) * HOUR - MIN))
    events.push(ev("sent", MIN))
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "verify", locksAfter: false })
  })

  it("ロックの記録がなくても、すでに 10 回あればロック中として断る", () => {
    const events: OtpEventRecord[] = []
    for (let i = 0; i < 10; i++) events.push(ev("sent", (20 - i) * HOUR), ev("attempted", (20 - i) * HOUR - MIN))
    events.push(ev("sent", MIN))
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "reject", reason: "locked" })
  })
})

describe("otpAbusePolicy: ロックの解除（#61 A3b）", () => {
  it("ロックの後に unlocked（別の IP からのログインの成功）があれば、ロックは解けている", () => {
    const events = [ev("locked", 2 * HOUR), ev("unlocked", HOUR, OTHER_IP), ev("sent", MIN)]
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "verify", locksAfter: false })
    expect(decideSend([ev("locked", 2 * HOUR), ev("unlocked", HOUR, OTHER_IP)], IP, NOW)).toEqual({ kind: "send" })
  })

  it("unlocked の後にもう一度ロックされたら、またロック中", () => {
    const events = [ev("unlocked", 3 * HOUR, OTHER_IP), ev("locked", 2 * HOUR), ev("sent", MIN)]
    expect(decideVerify(events, IP, NOW)).toEqual({ kind: "reject", reason: "locked" })
  })
})

describe("otpAbusePolicy: 対話型のチャレンジ（#61 A3b）", () => {
  it("送信が 20 通に達したアドレスは対話型のチャレンジが要る（IP を問わない）", () => {
    expect(requiresChallenge({ sentLast24h: 19, failuresSinceUnlockLast24h: 0 })).toBe(false)
    expect(requiresChallenge({ sentLast24h: 20, failuresSinceUnlockLast24h: 0 })).toBe(true)
  })

  it("失敗が 30 回に達したアドレスも対話型のチャレンジが要る", () => {
    expect(requiresChallenge({ sentLast24h: 0, failuresSinceUnlockLast24h: 29 })).toBe(false)
    expect(requiresChallenge({ sentLast24h: 0, failuresSinceUnlockLast24h: 30 })).toBe(true)
  })

  it("未登録のアドレスでも送信が 20 通でチャレンジが要る（判定は数だけで、登録の有無を受け取らない）", () => {
    expect(requiresChallenge.length).toBe(1)
    expect(requiresChallenge({ sentLast24h: 20, failuresSinceUnlockLast24h: 0 })).toBe(true)
  })
})

describe("otpAbusePolicy: 本人への通知・管理者への知らせ（#61 A3b）", () => {
  it("登録済みのアドレスに、直近 24 時間に通知していなければ通知する", () => {
    expect(shouldNotify({ registered: true, lastNotifiedAt: undefined, now: NOW })).toBe(true)
    expect(shouldNotify({ registered: true, lastNotifiedAt: ago(24 * HOUR), now: NOW })).toBe(true)
  })

  it("直近 24 時間に通知していれば、もう通知しない（1 通だけ）", () => {
    expect(shouldNotify({ registered: true, lastNotifiedAt: ago(23 * HOUR), now: NOW })).toBe(false)
  })

  it("未登録のアドレスには通知しない", () => {
    expect(shouldNotify({ registered: false, lastNotifiedAt: undefined, now: NOW })).toBe(false)
  })

  it("直近 24 時間の送信が 70 通を超え、24 時間に知らせていなければ管理者に知らせる", () => {
    expect(shouldAlert({ sentLast24h: 70, lastAlertedAt: undefined, now: NOW })).toBe(false)
    expect(shouldAlert({ sentLast24h: 71, lastAlertedAt: undefined, now: NOW })).toBe(true)
    expect(shouldAlert({ sentLast24h: 72, lastAlertedAt: ago(HOUR), now: NOW })).toBe(false)
    expect(shouldAlert({ sentLast24h: 72, lastAlertedAt: ago(24 * HOUR), now: NOW })).toBe(true)
  })
})

describe("otpAbusePolicy: 記録の保持", () => {
  it(`${OTP_POLICY.retentionMs / (24 * HOUR)} 日より古い記録は消す対象`, () => {
    expect(isExpiredOtpEvent(ago(30 * 24 * HOUR + SEC), NOW)).toBe(true)
    expect(isExpiredOtpEvent(ago(30 * 24 * HOUR - SEC), NOW)).toBe(false)
  })

  it("上限の値は承認済みの設計のとおり", () => {
    expect(OTP_POLICY).toEqual({
      resendIntervalMs: 60 * SEC,
      sendsPerAddressIpPerWindow: 5,
      attemptsPerCode: 3,
      attemptsPerAddressIpBeforeLock: 10,
      lockDurationMs: 24 * HOUR,
      windowMs: 24 * HOUR,
      retentionMs: 30 * 24 * HOUR,
      challengeSendsPerAddress: 20,
      challengeFailuresPerAddress: 30,
      noticeIntervalMs: 24 * HOUR,
      alertSendsAbove: 70,
      alertIntervalMs: 24 * HOUR,
    })
  })
})
