import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeDb, type FakeDbOptions } from "./helpers/fakeDb"

/**
 * ShoppingSyncService.deleteList の「リストと同じ名前の未購入の商品も消す」指定（179b）
 *
 * 記録用の DB で、ロック・候補の読み込み・書き込みの条件と、同期の記録を確かめる。
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

import { ShoppingSyncService } from "../application/services/ShoppingSyncService"
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

const repoDelete = vi.fn()
const service = () => new ShoppingSyncService({ delete: repoDelete } as unknown as ShoppingListRepository)

const setup = (options: FakeDbOptions) => {
  state.fake = createFakeDb({ lockedList: personalList, ...options })
}

const queriesOf = (table: string, kind: string) =>
  state.fake.queries.filter((q) => q.table === table && q.kind === kind)
const ops = () => state.syncOps.map((o) => [o.entity, o.operation, o.entityId])

describe("ShoppingSyncService.deleteList（商品も消す指定。179b）", () => {
  beforeEach(() => {
    state.syncOps = []
    repoDelete.mockReset().mockResolvedValue(undefined)
  })

  it("指定するとリストと同じ名前の未購入の商品を論理削除する", async () => {
    setup({
      entries: [
        { id: "li-milk", name: "牛乳", checked: false },
        { id: "li-egg", name: "卵", checked: false },
      ],
      catalogItems: [catalog("milk"), catalog("egg", { name: "卵" })],
    })

    await service().deleteList("list-1", "user-A", { deleteCatalogItems: true })

    const [update] = queriesOf("items", "update")
    expect(update.set).toHaveProperty("deletedAt")
    expect(update.params).toEqual(expect.arrayContaining(["milk", "egg"]))
    // タグの関連も消す
    const [tagDelete] = queriesOf("item_tags", "delete")
    expect(tagDelete.params).toEqual(expect.arrayContaining(["milk", "egg"]))
    // リスト（とリストの商品）は同じトランザクションで消す
    expect(repoDelete).toHaveBeenCalledWith("list-1", "user-A", expect.anything())
    // 同期の記録はカタログの商品とリストの削除
    expect(ops()).toEqual([
      ["item", "delete", "milk"],
      ["item", "delete", "egg"],
      ["list", "delete", "list-1"],
    ])
  })

  it("ほかのスコープ・購入済み・削除済みの同じ名前の商品は消さない", async () => {
    setup({
      lockedList: groupList,
      entries: [{ id: "li-milk", name: "牛乳", checked: false }],
      catalogItems: [
        catalog("target", { groupId: "group-1" }),
        catalog("otherGroup", { groupId: "group-2" }),
        catalog("personal"),
        catalog("purchased", { groupId: "group-1", purchasedAt: PURCHASED }),
        catalog("deleted", { groupId: "group-1", deletedAt: PURCHASED }),
      ],
    })

    await service().deleteList("list-1", "user-A", { deleteCatalogItems: true })

    const [update] = queriesOf("items", "update")
    expect(update.params).toContain("target")
    for (const id of ["otherGroup", "personal", "purchased", "deleted"]) expect(update.params).not.toContain(id)
    // 書き込みの WHERE でも、スコープ・未削除・未購入に限る
    expect(update.sql).toContain('"items"."group_id" =')
    expect(update.sql).toContain('"items"."deleted_at" is null')
    expect(update.sql).toContain('"items"."purchased_at" is null')
    expect(ops()).toEqual([
      ["item", "delete", "target"],
      ["list", "delete", "list-1"],
    ])
  })

  it("リストは、操作したユーザーが使える、削除されていない行をロックして読む", async () => {
    setup({ entries: [{ id: "li-milk", name: "牛乳", checked: false }], catalogItems: [catalog("milk")] })

    await service().deleteList("list-1", "user-A", { deleteCatalogItems: true })

    const [lock] = queriesOf("shopping_lists", "select")
    expect(lock.forUpdate).toBe(true)
    expect(lock.sql).toContain('"shopping_lists"."deleted_at" is null')
    expect(lock.sql).toContain('"group_members"."user_id"')
  })

  it("確認の後に使えなくなったリストでは、カタログの商品に触れない", async () => {
    setup({ lockedList: null, entries: [{ id: "li-milk", name: "牛乳", checked: false }], catalogItems: [catalog("milk")] })

    await service().deleteList("list-1", "user-A", { deleteCatalogItems: true })

    expect(state.fake.queries.filter((q) => q.table === "items")).toHaveLength(0)
    expect(state.syncOps.filter((o) => o.entity === "item")).toHaveLength(0)
  })

  it("指定しないとリストだけを消す", async () => {
    setup({ entries: [{ id: "li-milk", name: "牛乳", checked: false }], catalogItems: [catalog("milk")] })

    await service().deleteList("list-1", "user-A")

    expect(state.fake.queries).toHaveLength(0)
    expect(repoDelete).toHaveBeenCalledWith("list-1", "user-A")
    expect(ops()).toEqual([["list", "delete", "list-1"]])
  })

  it("途中で失敗したら何も消さない（同じトランザクションで書き、同期の記録も書かない）", async () => {
    setup({ entries: [{ id: "li-milk", name: "牛乳", checked: false }], catalogItems: [catalog("milk")] })
    repoDelete.mockRejectedValue(new Error("list delete failed"))

    await expect(service().deleteList("list-1", "user-A", { deleteCatalogItems: true })).rejects.toThrow(
      "list delete failed"
    )

    expect(state.fake.queries.length).toBeGreaterThan(0)
    expect(state.fake.queries.every((q) => q.inTransaction)).toBe(true)
    expect(state.syncOps).toHaveLength(0)
  })
})
