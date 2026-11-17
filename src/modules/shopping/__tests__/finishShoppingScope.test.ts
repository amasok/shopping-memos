import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeDb, type FakeDbOptions } from "./helpers/fakeDb"

/**
 * ShoppingService.finishShopping（tRPC の買い物の完了。#64・#62 O3b・#179・179b）
 *
 * 記録用の DB で、ロック・候補の読み込み・書き込みの条件と、記録する ID を確かめる。
 * 実際の SQL の結果は shopping-completion.db.test.ts（実 DB）で確かめる
 */
const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fakeDb").createFakeDb>,
  syncOps: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => state.fake.db.transaction(cb),
  },
}))
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({
  syncRepository: {
    createOperation: async (op: Record<string, unknown>) => {
      state.syncOps.push(op)
    },
  },
}))

import { ShoppingService, ShoppingDomainError } from "../application/services/ShoppingService"
import type { ShoppingListRepository } from "../domain/repositories/ShoppingListRepository"

const PURCHASED = new Date("2025-12-01T00:00:00.000Z")
const personalList = { id: "list-1", userId: "user-A", groupId: null, status: "in_progress", purchasedAt: null }
const groupList = { ...personalList, groupId: "group-1" }

const catalog = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: "牛乳",
  userId: "user-A",
  groupId: null,
  purchasedAt: null,
  deletedAt: null,
  ...over,
})

const service = () => {
  const repo = { findById: async () => ({ id: "list-1", items: [] }) } as unknown as ShoppingListRepository
  return new ShoppingService(repo)
}

const setup = (options: FakeDbOptions) => {
  state.fake = createFakeDb({ lockedList: personalList, ...options })
}

const queriesOf = (table: string, kind: string) =>
  state.fake.queries.filter((q) => q.table === table && q.kind === kind)
const itemOpIds = () => state.syncOps.filter((o) => o.entity === "item").map((o) => o.entityId)

describe("ShoppingService.finishShopping（tRPC の買い物の完了）", () => {
  beforeEach(() => {
    state.syncOps = []
  })

  it("チェック済みの商品と同じ名前の商品を購入済みにする", async () => {
    setup({
      entries: [
        { id: "li-milk", name: "牛乳", checked: true },
        { id: "li-egg", name: "卵", checked: false },
      ],
      catalogItems: [catalog("milk"), catalog("egg", { name: "卵" })],
    })

    const result = await service().finishShopping("list-1", "user-A")

    const [update] = queriesOf("items", "update")
    expect(update.set).toHaveProperty("purchasedAt")
    expect(update.params).toContain("milk")
    expect(update.params).not.toContain("egg")
    expect(itemOpIds()).toEqual(["milk"])
    // 戻り値の purchasedItemIds は、今と同じくチェック済みのリストの商品の ID
    expect(result.purchasedItemIds).toEqual(["li-milk"])
  })

  it("同じ名前の購入済みの商品の購入日時は変えない", async () => {
    setup({
      entries: [{ id: "li-milk", name: "牛乳", checked: true }],
      catalogItems: [catalog("unpurchased"), catalog("purchased", { purchasedAt: PURCHASED })],
    })

    await service().finishShopping("list-1", "user-A")

    const [update] = queriesOf("items", "update")
    expect(update.params).toContain("unpurchased")
    expect(update.params).not.toContain("purchased")
    // 書き込みの WHERE でも未購入に限る（読んだ後にほかの操作で購入済みになったものを上書きしない）
    expect(update.sql).toContain('"items"."purchased_at" is null')
    expect(itemOpIds()).toEqual(["unpurchased"])
  })

  it("記録する商品の ID は、購入済み・別スコープ・削除済みを混ぜても、実際に更新したものだけ", async () => {
    setup({
      entries: [{ id: "li-milk", name: "牛乳", checked: true }],
      catalogItems: [
        catalog("mine"),
        catalog("mine-purchased", { purchasedAt: PURCHASED }),
        catalog("others", { userId: "user-B" }),
        catalog("group", { groupId: "group-1" }),
        catalog("deleted", { deletedAt: PURCHASED }),
      ],
    })

    await service().finishShopping("list-1", "user-A")

    const [update] = queriesOf("items", "update")
    expect(update.params).not.toContain("others")
    expect(update.params).not.toContain("group")
    expect(update.params).not.toContain("deleted")
    expect(update.params).not.toContain("mine-purchased")
    expect(itemOpIds()).toEqual(["mine"])
  })

  it("候補の読み込みと書き込みは、個人のリストなら作成者の groupId なしの商品に限る", async () => {
    setup({ entries: [{ id: "li-milk", name: "牛乳", checked: true }], catalogItems: [catalog("mine")] })

    await service().finishShopping("list-1", "user-A")

    for (const q of [...queriesOf("items", "select"), ...queriesOf("items", "update")]) {
      expect(q.sql).toContain('"items"."group_id" is null')
      expect(q.sql).toContain('"items"."user_id" =')
      expect(q.sql).toContain('"items"."deleted_at" is null')
      expect(q.params).toContain("user-A")
    }
  })

  it("候補の読み込みと書き込みは、グループのリストならグループの商品に限る", async () => {
    setup({
      lockedList: groupList,
      entries: [{ id: "li-milk", name: "牛乳", checked: true }],
      catalogItems: [catalog("g-milk", { groupId: "group-1" })],
    })

    await service().finishShopping("list-1", "user-B")

    for (const q of [...queriesOf("items", "select"), ...queriesOf("items", "update")]) {
      expect(q.sql).toContain('"items"."group_id" =')
      expect(q.sql).not.toContain('"items"."user_id"')
      expect(q.params).toContain("group-1")
    }
    expect(itemOpIds()).toEqual(["g-milk"])
  })

  it("tRPC にチェック 0 件の完了が届くと断る（何も書かない）", async () => {
    setup({
      entries: [
        { id: "li-milk", name: "牛乳", checked: false },
        { id: "li-egg", name: "卵", checked: false },
      ],
      catalogItems: [catalog("milk")],
    })

    await expect(service().finishShopping("list-1", "user-A")).rejects.toThrow(
      new ShoppingDomainError("カゴに入れた商品がありません")
    )
    expect(state.fake.queries.filter((q) => q.kind !== "select")).toHaveLength(0)
    expect(state.syncOps).toHaveLength(0)
  })

  it("未チェックの商品をリストから外す（物理削除せず論理削除する）", async () => {
    setup({
      entries: [
        { id: "li-milk", name: "牛乳", checked: true },
        { id: "li-egg", name: "卵", checked: false },
      ],
    })

    await service().finishShopping("list-1", "user-A")

    const listItemWrites = state.fake.queries.filter((q) => q.table === "list_items" && q.kind !== "select")
    expect(listItemWrites.map((q) => q.kind)).toEqual(["update"])
    expect(listItemWrites[0].set).toHaveProperty("deletedAt")
    expect(listItemWrites[0].params).toContain("li-egg")
    expect(listItemWrites[0].params).not.toContain("li-milk")
  })

  it("全部チェック済みならリストの商品はすべて残る", async () => {
    setup({
      entries: [
        { id: "li-milk", name: "牛乳", checked: true },
        { id: "li-egg", name: "卵", checked: true },
      ],
    })

    await service().finishShopping("list-1", "user-A")

    expect(queriesOf("list_items", "update")).toHaveLength(0)
  })

  it("完了したリストに購入日時と場所が入る", async () => {
    setup({ entries: [{ id: "li-milk", name: "牛乳", checked: true }] })

    await service().finishShopping("list-1", "user-A", "スーパー")

    const [listUpdate] = queriesOf("shopping_lists", "update")
    expect(listUpdate.set).toMatchObject({ status: "completed", location: "スーパー" })
    const set = listUpdate.set as { completedAt: Date; purchasedAt: Date }
    expect(set.completedAt).toBeInstanceOf(Date)
    expect(set.purchasedAt).toBe(set.completedAt)
    expect(listUpdate.set).toHaveProperty("fieldModifiedAt")
  })

  it("完了済みのリストは完了できない（何も書かない）", async () => {
    setup({ lockedList: { ...personalList, status: "completed" }, entries: [{ id: "li", name: "牛乳", checked: true }] })

    await expect(service().finishShopping("list-1", "user-A")).rejects.toThrow(
      new ShoppingDomainError("このリストは既に完了しています")
    )
    expect(state.fake.queries.filter((q) => q.kind !== "select")).toHaveLength(0)
    expect(state.syncOps).toHaveLength(0)
  })

  it("リストは、操作したユーザーが使える、削除されていない行をロックして読む", async () => {
    setup({ entries: [{ id: "li", name: "牛乳", checked: true }] })

    await service().finishShopping("list-1", "user-A")

    const [lock] = queriesOf("shopping_lists", "select")
    expect(lock.forUpdate).toBe(true)
    expect(lock.sql).toContain('"shopping_lists"."deleted_at" is null')
    expect(lock.sql).toContain('"group_members"."user_id"')
    const [listUpdate] = queriesOf("shopping_lists", "update")
    expect(listUpdate.sql).toContain('"shopping_lists"."deleted_at" is null')
    expect(listUpdate.sql).toContain('"group_members"."user_id"')
  })

  it("確認の後に使えなくなったリストは完了しない（ロックで読めなければ何も書かない）", async () => {
    setup({ lockedList: null, entries: [{ id: "li", name: "牛乳", checked: true }], catalogItems: [catalog("milk")] })

    await expect(service().finishShopping("list-1", "user-A")).rejects.toThrow(
      new ShoppingDomainError("リストが見つかりません")
    )
    expect(state.fake.queries.filter((q) => q.kind !== "select")).toHaveLength(0)
    expect(state.syncOps).toHaveLength(0)
  })

  it("リストの更新が 0 行なら「リストが見つかりません」にし、同期の記録を書かない", async () => {
    setup({ entries: [{ id: "li", name: "牛乳", checked: true }], catalogItems: [catalog("milk")], listUpdateRows: [] })

    await expect(service().finishShopping("list-1", "user-A")).rejects.toThrow(
      new ShoppingDomainError("リストが見つかりません")
    )
    expect(state.syncOps).toHaveLength(0)
  })

  it("読み込みと書き込みはすべてトランザクションの中で行う", async () => {
    setup({
      entries: [
        { id: "li", name: "牛乳", checked: true },
        { id: "li2", name: "卵", checked: false },
      ],
      catalogItems: [catalog("milk")],
    })

    await service().finishShopping("list-1", "user-A")

    expect(state.fake.queries.length).toBeGreaterThan(0)
    expect(state.fake.queries.every((q) => q.inTransaction)).toBe(true)
  })
})
