import { describe, it, expect } from "vitest"
import { createRateLimiter, getClientIp } from "../rate-limit"

describe("createRateLimiter", () => {
  const opts = { limit: 3, windowMs: 1000, maxKeys: 100 }

  it("上限までは許可し、超えたら拒否する", () => {
    const limiter = createRateLimiter(opts)

    expect([1, 2, 3, 4].map(() => limiter.consume("ip", 0))).toEqual([true, true, true, false])
  })

  it("キーごとに独立して数える", () => {
    const limiter = createRateLimiter(opts)
    for (let i = 0; i < 3; i++) limiter.consume("a", 0)

    expect(limiter.consume("a", 0)).toBe(false)
    expect(limiter.consume("b", 0)).toBe(true)
  })

  it("ウィンドウが過ぎたらカウントがリセットされる", () => {
    const limiter = createRateLimiter(opts)
    for (let i = 0; i < 3; i++) limiter.consume("ip", 0)
    expect(limiter.consume("ip", 999)).toBe(false)

    expect(limiter.consume("ip", 1000)).toBe(true)
  })

  it("reset で全キーのカウントを消す", () => {
    const limiter = createRateLimiter(opts)
    for (let i = 0; i < 3; i++) limiter.consume("ip", 0)

    limiter.reset()

    expect(limiter.consume("ip", 0)).toBe(true)
  })

  it("キー数の上限に達したら、期限切れのキーを先に捨てて新しいキーを受け付ける", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 })
    limiter.consume("old1", 0)
    limiter.consume("old2", 0)

    // 期限切れ後に新しいキーが来ても許可される
    expect(limiter.consume("new", 2000)).toBe(true)
    // 期限切れだった old1 は新しいウィンドウとして扱われる
    expect(limiter.consume("old1", 2000)).toBe(true)
  })

  it("期限切れがなくキー数が上限なら、最も古いキーを捨てて新しいキーを受け付ける（メモリが無制限に増えない）", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000, maxKeys: 2 })
    limiter.consume("first", 0)
    limiter.consume("second", 0)

    expect(limiter.consume("third", 1)).toBe(true)
    // 最も古い first は捨てられたので、再び 1 回目として許可される
    expect(limiter.consume("first", 2)).toBe(true)
  })
})

describe("getClientIp", () => {
  it("x-real-ip を優先する", () => {
    const headers = new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" })

    expect(getClientIp(headers)).toBe("1.2.3.4")
  })

  it("x-real-ip がなければ x-forwarded-for の先頭を使う", () => {
    const headers = new Headers({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" })

    expect(getClientIp(headers)).toBe("5.6.7.8")
  })

  it("どちらもなければ unknown", () => {
    expect(getClientIp(new Headers())).toBe("unknown")
  })
})
