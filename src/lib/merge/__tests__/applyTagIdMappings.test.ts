import { describe, it, expect } from "vitest"
import { applyTagIdMappings } from "../applyTagIdMappings"

const chunk = () => ({
  tags: [{ id: "t-new" }],
  items: [
    { id: "i1", tagIds: ["t-old", "t-keep"] },
    { id: "i2", tagIds: ["t-keep"] },
  ],
  lists: [],
  listItems: [{ id: "li1", tagIds: ["t-old"] }],
  history: [],
})

describe("applyTagIdMappings", () => {
  it("アイテム・リストアイテムの tagIds を、付け替えた ID にする（ほかの ID はそのまま）", () => {
    const result = applyTagIdMappings(chunk(), new Map([["t-old", "t-server"]]))
    expect(result.items.map((i) => i.tagIds)).toEqual([["t-server", "t-keep"], ["t-keep"]])
    expect(result.listItems[0].tagIds).toEqual(["t-server"])
    expect(result.tags).toEqual([{ id: "t-new" }])
  })

  it("付け替えがなければ、同じチャンクをそのまま返す", () => {
    const original = chunk()
    expect(applyTagIdMappings(original, new Map())).toBe(original)
  })

  it("元のチャンクは変更しない", () => {
    const original = chunk()
    applyTagIdMappings(original, new Map([["t-old", "t-server"]]))
    expect(original.items[0].tagIds).toEqual(["t-old", "t-keep"])
  })
})
