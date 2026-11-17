import { describe, it, expect } from "vitest"
import { canRevert, planRevertHistory } from "../revertHistory"
import { ListStatus } from "../../value-objects/ListStatus"

const PURCHASED = new Date("2026-01-02T00:00:00.000Z")

describe("canRevert", () => {
  it("購入日時が入っているリストだけ取り消せる", () => {
    expect(canRevert({ purchasedAt: PURCHASED })).toBe(true)
    expect(canRevert({ purchasedAt: "2026-01-02T00:00:00.000Z" })).toBe(true)
    expect(canRevert({ purchasedAt: null })).toBe(false)
    expect(canRevert({ purchasedAt: undefined })).toBe(false)
  })
})

describe("planRevertHistory", () => {
  it("購入日時がないと not_completed", () => {
    expect(planRevertHistory({ purchasedAt: null, entries: [{ name: "牛乳" }] })).toEqual({
      ok: false,
      reason: "not_completed",
    })
  })

  it("リストの商品の名前を未購入に戻す対象にする（重複は 1 回だけ）", () => {
    const plan = planRevertHistory({ purchasedAt: PURCHASED, entries: [{ name: "牛乳" }, { name: "卵" }, { name: "牛乳" }] })
    expect(plan).toMatchObject({ ok: true, revertNames: ["牛乳", "卵"] })
  })

  it("戻した状態は進行中で、完了日時・購入日時・場所が null", () => {
    const plan = planRevertHistory({ purchasedAt: PURCHASED, entries: [] })
    expect(plan).toEqual({
      ok: true,
      revertNames: [],
      listState: { status: ListStatus.IN_PROGRESS, completedAt: null, purchasedAt: null, location: null },
    })
  })
})
