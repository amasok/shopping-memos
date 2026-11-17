import { describe, it, expect } from "vitest"
import { snapshotListItem } from "../snapshot"

describe("snapshotListItem", () => {
  it("カタログの商品の名前・数量・メモ・タグを写す", () => {
    const tagIds = ["tag-food"]
    const snap = snapshotListItem(
      { name: "牛乳", quantity: 2, memo: "低脂肪", tagIds },
      { id: "list-1", groupId: null },
      "li-1"
    )
    expect(snap).toEqual({
      id: "li-1",
      listId: "list-1",
      name: "牛乳",
      quantity: 2,
      memo: "低脂肪",
      tagIds: ["tag-food"],
      groupId: null,
    })
    // 写しなので、元の配列を変えても変わらない
    tagIds.push("tag-other")
    expect(snap.tagIds).toEqual(["tag-food"])
  })

  it("リストの商品の groupId はリストの groupId にする", () => {
    const snap = snapshotListItem(
      { name: "牛乳", quantity: 1, memo: null, tagIds: [] },
      { id: "list-1", groupId: "group-A" },
      "li-1"
    )
    expect(snap.groupId).toBe("group-A")
  })

  it("メモがなければ null、グループのないリストなら groupId は null", () => {
    const snap = snapshotListItem({ name: "卵", quantity: 1, memo: undefined, tagIds: [] }, { id: "l", groupId: undefined }, "i")
    expect(snap.memo).toBeNull()
    expect(snap.groupId).toBeNull()
  })
})
