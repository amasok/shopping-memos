import { describe, expect, it } from "vitest"
import { computeServerTimeOffset, createClock } from "../clock"

describe("computeServerTimeOffset（時計のずれ）", () => {
  it("送ってから受け取るまでの真ん中とサーバーの時刻の差を返す", () => {
    const sent = Date.parse("2026-11-17T10:00:00.000Z")
    const received = sent + 200
    // 端末の時計が 5 秒遅れている（真ん中の 10:00:00.100 にサーバーは 10:00:05.100）
    expect(computeServerTimeOffset("2026-11-17T10:00:05.100Z", sent, received)).toBe(5000)
  })

  it("serverTime が時刻として読めなければ 0 にする", () => {
    expect(computeServerTimeOffset("not-a-date", 0, 0)).toBe(0)
  })
})

describe("createClock", () => {
  it("補正した時刻を返し、offset を変えると操作時刻に反映される", () => {
    const device = Date.parse("2026-11-17T10:00:00.000Z")
    const clock = createClock(0, () => device)
    expect(clock.now().toISOString()).toBe("2026-11-17T10:00:00.000Z")
    clock.setOffset(-3000)
    expect(clock.getOffset()).toBe(-3000)
    expect(clock.now().toISOString()).toBe("2026-11-17T09:59:57.000Z")
  })
})
