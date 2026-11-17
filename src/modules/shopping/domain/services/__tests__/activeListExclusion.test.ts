import { describe, it, expect } from "vitest"
import { excludeItemsInActiveLists } from "../activeListExclusion"

describe("excludeItemsInActiveLists", () => {
  const items = [
    { id: "milk", name: "牛乳" },
    { id: "egg", name: "卵" },
    { id: "milk2", name: "牛乳" },
  ]

  it("進行中のリストにある商品と同じ名前の商品を除き、ほかは順番どおり残す", () => {
    expect(excludeItemsInActiveLists(items, ["牛乳"]).map((i) => i.id)).toEqual(["egg"])
  })

  it("進行中のリストの商品がなければ、すべて残す", () => {
    expect(excludeItemsInActiveLists(items, []).map((i) => i.id)).toEqual(["milk", "egg", "milk2"])
  })
})
