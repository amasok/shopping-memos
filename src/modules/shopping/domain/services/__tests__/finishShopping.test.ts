import { describe, it, expect } from "vitest"
import { planFinishShopping } from "../finishShopping"
import { ListStatus } from "../../value-objects/ListStatus"

const AT = new Date("2026-01-02T00:00:00.000Z")
const entry = (id: string, name: string, checked: boolean) => ({ id, name, checked })

describe("planFinishShopping", () => {
  it("進行中でないリストは not_in_progress", () => {
    expect(planFinishShopping({ status: ListStatus.COMPLETED, entries: [entry("a", "牛乳", true)], at: AT })).toEqual({
      ok: false,
      reason: "not_in_progress",
    })
  })

  it("チェック済みの商品の名前を購入済みにし、未チェックの商品を外す", () => {
    const plan = planFinishShopping({
      status: ListStatus.IN_PROGRESS,
      entries: [entry("milk", "牛乳", true), entry("egg", "卵", false), entry("bread", "パン", true)],
      at: AT,
    })
    expect(plan).toMatchObject({ ok: true, purchaseNames: ["牛乳", "パン"], removeEntryIds: ["egg"] })
  })

  it("同じ名前のチェック済みの商品が複数あっても、名前は 1 回だけ", () => {
    const plan = planFinishShopping({
      status: ListStatus.IN_PROGRESS,
      entries: [entry("a", "牛乳", true), entry("b", "牛乳", true)],
      at: AT,
    })
    expect(plan).toMatchObject({ ok: true, purchaseNames: ["牛乳"] })
  })

  it("全部チェック済みなら外す商品は 0 件", () => {
    const plan = planFinishShopping({
      status: ListStatus.IN_PROGRESS,
      entries: [entry("a", "牛乳", true), entry("b", "卵", true)],
      at: AT,
    })
    expect(plan).toMatchObject({ ok: true, removeEntryIds: [] })
  })

  it("チェック 0 件なら no_checked_items（179b「チェック 0 件の完了」）", () => {
    const plan = planFinishShopping({
      status: ListStatus.IN_PROGRESS,
      entries: [entry("a", "牛乳", false), entry("b", "卵", false)],
      at: AT,
    })
    expect(plan).toEqual({ ok: false, reason: "no_checked_items" })
  })

  it("商品が 0 件のリストも no_checked_items", () => {
    expect(planFinishShopping({ status: ListStatus.IN_PROGRESS, entries: [], at: AT })).toEqual({
      ok: false,
      reason: "no_checked_items",
    })
  })

  it("完了済みでチェック 0 件なら not_in_progress を先に返す", () => {
    expect(planFinishShopping({ status: ListStatus.COMPLETED, entries: [], at: AT })).toEqual({
      ok: false,
      reason: "not_in_progress",
    })
  })

  it("リストの状態は完了になり、完了日時と購入日時に時刻、場所に指定した値が入る", () => {
    const plan = planFinishShopping({
      status: ListStatus.IN_PROGRESS,
      entries: [entry("a", "牛乳", true)],
      at: AT,
      location: "スーパー",
    })
    expect(plan).toMatchObject({
      ok: true,
      listState: { status: ListStatus.COMPLETED, completedAt: AT, purchasedAt: AT, location: "スーパー" },
    })
  })

  it("場所を指定しなければ null", () => {
    const plan = planFinishShopping({ status: ListStatus.IN_PROGRESS, entries: [entry("a", "牛乳", true)], at: AT })
    expect(plan).toMatchObject({ ok: true, listState: { location: null } })
  })
})
