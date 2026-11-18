// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ShoppingMemosDB, type ShoppingItem } from "@/lib/db"
import { queryItems, queryTags } from "../catalogQueries"

const GROUP = "group-a"
let db: ShoppingMemosDB
let seq = 0

async function item(name: string, over: Partial<ShoppingItem> = {}) {
  seq += 1
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, seq))
  const row: ShoppingItem = { id: `item-${seq}`, name, quantity: 1, tagIds: [], createdAt: at, updatedAt: at, ...over }
  await db.items.add(row)
  return row.id
}

async function list(status: "in_progress" | "completed", names: string[], groupId?: string) {
  seq += 1
  const id = `list-${seq}`
  await db.lists.add({ id, name: "買い物", status, groupId, createdAt: new Date(), updatedAt: new Date() })
  for (const name of names) {
    seq += 1
    await db.listItems.add({ id: `li-${seq}`, listId: id, name, quantity: 1, tagIds: [], groupId, checked: false, createdAt: new Date(), updatedAt: new Date() })
  }
}

beforeEach(() => {
  seq = 0
  db = new ShoppingMemosDB(`catalog-query-test-${crypto.randomUUID()}`)
})

afterEach(async () => {
  await db.delete()
})

describe("queryItems（端末の DB の商品の一覧）", () => {
  it("選んでいるグループの商品だけを出す", async () => {
    await item("個人の牛乳")
    const groups = await item("グループの牛乳", { groupId: GROUP })

    expect((await queryItems(db, { groupId: GROUP })).map((i) => i.id)).toEqual([groups])
  })

  it("購入済みの商品は指定がなければ出ない", async () => {
    const open = await item("牛乳")
    const bought = await item("卵", { purchasedAt: new Date() })

    expect((await queryItems(db, { groupId: undefined })).map((i) => i.id)).toEqual([open])
    expect((await queryItems(db, { groupId: undefined, purchasedOnly: true })).map((i) => i.id)).toEqual([bought])
    expect((await queryItems(db, { groupId: undefined, includePurchased: true })).map((i) => i.id)).toEqual([open, bought])
  })

  it("タグを指定するとどれかのタグが付いた商品だけを出す", async () => {
    const x = await item("牛乳", { tagIds: ["tag-x"] })
    const y = await item("卵", { tagIds: ["tag-y", "tag-z"] })
    await item("パン")

    expect((await queryItems(db, { groupId: undefined, tagIds: ["tag-x", "tag-y"] })).map((i) => i.id)).toEqual([x, y])
  })

  it("進行中のリストにある商品は一覧に出ない", async () => {
    await item("牛乳", { groupId: GROUP })
    const egg = await item("卵", { groupId: GROUP })
    const bread = await item("パン", { groupId: GROUP })
    await list("in_progress", ["牛乳"], GROUP)
    await list("completed", ["卵"], GROUP)
    // ほかのスコープ（個人）の進行中のリストは除く理由にしない
    await list("in_progress", ["パン"])

    expect((await queryItems(db, { groupId: GROUP })).map((i) => i.id)).toEqual([egg, bread])
  })

  it("ローカルファーストの並びはサーバーと同じ作成日時の古い順", async () => {
    const first = await item("牛乳")
    const second = await item("卵")
    const third = await item("パン")

    expect((await queryItems(db, { groupId: undefined })).map((i) => i.id)).toEqual([first, second, third])
  })

  it("ゲストの商品の並びもサーバーと同じ作成日時の古い順", async () => {
    // ID の順と作成日時の順を逆にする（並べ替えに頼らないと ID の順になる）
    const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s))
    await db.items.add({ id: "c", name: "牛乳", quantity: 1, tagIds: [], createdAt: at(1), updatedAt: at(1) })
    await db.items.add({ id: "b", name: "卵", quantity: 1, tagIds: [], createdAt: at(2), updatedAt: at(2) })
    await db.items.add({ id: "a", name: "パン", quantity: 1, tagIds: [], createdAt: at(3), updatedAt: at(3) })

    // ゲストもローカルファーストも同じ関数で読む（モードで並びを分けない）
    expect((await queryItems(db, { groupId: undefined })).map((i) => i.id)).toEqual(["c", "b", "a"])
  })
})

describe("queryTags（端末の DB のタグの一覧）", () => {
  const tag = (id: string, name: string, groupId?: string) =>
    db.tags.add({ id, name, groupId, createdAt: new Date(), updatedAt: new Date() })

  it("ローカルファーストのタグは選んでいるグループのものを名前の文字コードの順に出す", async () => {
    await tag("t1", "食品")
    await tag("t2", "日用品")
    await tag("t3", "Banana")
    await tag("t4", "apple")
    await tag("t5", "グループのタグ", GROUP)

    expect((await queryTags(db, { groupId: undefined })).map((t) => t.name)).toEqual([
      "Banana",
      "apple",
      "日用品",
      "食品",
    ])
  })

  it("ゲストのタグも名前の文字コードの順に出す", async () => {
    // 既定のタグ（食品・日用品・エンタメ）。ID の順は名前の順と違う
    await tag("t1", "食品")
    await tag("t2", "日用品")
    await tag("t3", "エンタメ")
    await tag("t4", "グループのタグ", GROUP)

    expect((await queryTags(db, { groupId: undefined })).map((t) => t.name)).toEqual(["エンタメ", "日用品", "食品"])
  })
})
