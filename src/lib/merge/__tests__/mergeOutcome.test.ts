import { describe, it, expect } from "vitest"
import { buildMergeOutcome, collectFailedIds, emptyFailedIds, hasKeptRecords } from "../mergeOutcome"
import type { GuestDataForMerge } from "@/lib/db/guestData"

const NOW = new Date("2026-03-01T09:00:00Z")
const guest = (): GuestDataForMerge => ({
  tags: [
    { id: "t1", name: "食品", createdAt: NOW, updatedAt: NOW },
    { id: "t2", name: "お気に入り", createdAt: NOW, updatedAt: NOW },
  ],
  items: [
    { id: "i1", name: "牛乳", quantity: 1, tagIds: ["t1"], createdAt: NOW, updatedAt: NOW },
    { id: "i2", name: "卵", quantity: 1, tagIds: ["t2", "t-missing"], createdAt: NOW, updatedAt: NOW },
  ],
  lists: [{ id: "l1", name: "週末", status: "completed", createdAt: NOW, updatedAt: NOW, purchasedAt: NOW }],
  listItems: [{ id: "li1", listId: "l1", name: "牛乳", quantity: 1, tagIds: ["t1"], checked: true, createdAt: NOW }],
}) as unknown as GuestDataForMerge

const chunk = {
  tags: [{ id: "t1" }, { id: "t2" }],
  items: [{ id: "i1" }, { id: "i2" }],
  lists: [{ id: "l1" }],
  listItems: [{ id: "li1" }],
  history: [{ listId: "l1" }],
}

describe("collectFailedIds", () => {
  it("notImported の位置を、そのチャンクの配列と突き合わせて ID にする", () => {
    const failed = emptyFailedIds()
    collectFailedIds(chunk, { notImportedCount: 2, notImported: [{ entity: "items", requestIndex: 1 }, { entity: "tags", requestIndex: 0 }] }, failed)
    expect([...failed.items]).toEqual(["i2"])
    expect([...failed.tags]).toEqual(["t1"])
  })

  it("履歴が取り込めなかったら、そのリストを残す", () => {
    const failed = emptyFailedIds()
    collectFailedIds(chunk, { notImportedCount: 1, notImported: [{ entity: "history", requestIndex: 0 }] }, failed)
    expect([...failed.lists]).toEqual(["l1"])
  })

  it("範囲外の位置は無視する", () => {
    const failed = emptyFailedIds()
    collectFailedIds(chunk, { notImportedCount: 1, notImported: [{ entity: "items", requestIndex: 9 }] }, failed)
    expect(failed.items.size).toBe(0)
  })

  it("notImported がない古いサーバーで、取り込めなかったものがあれば、そのチャンクを全部残す", () => {
    const failed = emptyFailedIds()
    collectFailedIds(chunk, { notImportedCount: 1 }, failed)
    expect([...failed.items].sort()).toEqual(["i1", "i2"])
    expect([...failed.lists]).toEqual(["l1"])
    expect([...failed.listItems]).toEqual(["li1"])
  })

  it("notImported がなくても、取り込めなかったものがなければ何も残さない", () => {
    const failed = emptyFailedIds()
    collectFailedIds(chunk, { notImportedCount: 0 }, failed)
    expect(failed.items.size + failed.tags.size + failed.lists.size + failed.listItems.size).toBe(0)
  })
})

describe("buildMergeOutcome", () => {
  it("送ったのは読んだデータすべてで、残すのは取り込めなかったものと、それが参照するタグ（ゲストの DB にあるもの）", () => {
    const failed = emptyFailedIds()
    failed.items.add("i2")
    const outcome = buildMergeOutcome(guest(), failed)

    expect(outcome.sent).toEqual({ tags: ["t1", "t2"], items: ["i1", "i2"], lists: ["l1"], listItems: ["li1"] })
    expect(outcome.keep).toEqual({ tags: ["t2"], items: ["i2"], lists: [], listItems: [] })
    expect(hasKeptRecords(outcome)).toBe(true)
  })

  it("リストアイテムが残るときも、参照しているタグを残す", () => {
    const failed = emptyFailedIds()
    failed.listItems.add("li1")
    expect(buildMergeOutcome(guest(), failed).keep.tags).toEqual(["t1"])
  })

  it("全部取り込めたら、何も残さない", () => {
    const outcome = buildMergeOutcome(guest(), emptyFailedIds())
    expect(hasKeptRecords(outcome)).toBe(false)
  })
})
