// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ShoppingMemosDB, type ShoppingList } from "@/lib/db"
import { queryHistory, queryListItems, queryLists } from "../shoppingQueries"

const GROUP = "group-a"
let db: ShoppingMemosDB
let seq = 0
const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s))

async function list(id: string, over: Partial<ShoppingList> = {}) {
  seq += 1
  await db.lists.add({ id, name: id, status: "in_progress", createdAt: at(seq), ...over })
}

async function entry(id: string, listId: string, createdSec: number) {
  await db.listItems.add({ id, listId, name: id, quantity: 1, tagIds: [], checked: false, createdAt: at(createdSec) })
}

beforeEach(() => {
  seq = 0
  db = new ShoppingMemosDB(`shopping-query-test-${crypto.randomUUID()}`)
})

afterEach(async () => {
  await db.delete()
})

describe("queryLists / queryListItems / queryHistory", () => {
  it("進行中のリストだけを選んでいるグループから出す", async () => {
    await list("personal-open")
    await list("personal-done", { status: "completed", purchasedAt: at(50) })
    await list("group-open", { groupId: GROUP })

    expect((await queryLists(db, { groupId: undefined, order: "server" })).map((l) => l.id)).toEqual(["personal-open"])
    expect((await queryLists(db, { groupId: undefined, includeCompleted: true, order: "server" })).map((l) => l.id)).toEqual([
      "personal-open",
      "personal-done",
    ])
    expect((await queryLists(db, { groupId: undefined, includeAllGroups: true, order: "server" })).map((l) => l.id)).toEqual([
      "personal-open",
      "group-open",
    ])
  })

  it("ローカルファーストのリストとリストの商品は作成日時の古い順", async () => {
    // ID の順と作成日時の順を逆にする（並べ替えなしなら ID の順になる）
    await db.lists.add({ id: "b", name: "b", status: "in_progress", createdAt: at(1) })
    await db.lists.add({ id: "a", name: "a", status: "in_progress", createdAt: at(2) })
    await entry("z", "b", 1)
    await entry("y", "b", 2)
    await entry("x", "b", 3)

    expect((await queryLists(db, { groupId: undefined, order: "server" })).map((l) => l.id)).toEqual(["b", "a"])
    expect((await queryListItems(db, ["b"], "server")).map((e) => e.id)).toEqual(["z", "y", "x"])
    // ゲストは今のまま並べ替えない（ID の順）
    expect((await queryListItems(db, ["b"], "guest")).map((e) => e.id)).toEqual(["x", "y", "z"])
  })

  it("履歴は購入日時の新しい順にリストの商品つきで出す", async () => {
    await list("old", { status: "completed", purchasedAt: at(10) })
    await list("new", { status: "completed", purchasedAt: at(20) })
    await list("open")
    await entry("e1", "old", 1)
    await entry("e2", "new", 2)

    const history = await queryHistory(db, { groupId: undefined, order: "server" })

    expect(history.map((h) => [h.id, h.listItems.map((e) => e.id)])).toEqual([
      ["new", ["e2"]],
      ["old", ["e1"]],
    ])
    expect((await queryHistory(db, { groupId: undefined, limit: 1, offset: 1, order: "server" })).map((h) => h.id)).toEqual(["old"])
  })
})
