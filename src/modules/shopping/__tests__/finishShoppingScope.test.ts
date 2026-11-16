import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeDb } from "./helpers/fakeDb"

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

import { ShoppingService } from "../application/services/ShoppingService"
import type { ShoppingListRepository } from "../domain/repositories/ShoppingListRepository"

const makeList = (names: string[]) => ({
  id: "list-1",
  name: "買い物",
  status: "in_progress",
  groupId: null,
  createdAt: new Date(),
  completedAt: null,
  items: names.map((name, i) => ({
    id: `li-${i}`,
    listId: "list-1",
    name,
    quantity: 1,
    memo: null,
    tagIds: null,
    groupId: null,
    checked: true,
    createdAt: new Date(),
    tags: [],
  })),
})

const makeService = (names: string[]) => {
  const list = makeList(names)
  const repo = { findById: async () => list } as unknown as ShoppingListRepository
  return new ShoppingService(repo)
}

const itemUpdates = () => state.fake.queries.filter((q) => q.table === "items")

describe("ShoppingService.finishShopping のカタログアイテム更新範囲 (#64)", () => {
  beforeEach(() => {
    state.syncOps = []
  })

  it("個人リストの完了は、作成者のgroupIdなしアイテムだけを購入済みにする", async () => {
    state.fake = createFakeDb({
      listScope: { userId: "user-A", groupId: null },
      itemIdsByName: { 牛乳: ["mine-milk"] },
    })

    const result = await makeService(["牛乳"]).finishShopping("list-1", "user-A")

    const [q] = itemUpdates()
    expect(q.kind).toBe("update")
    expect(q.sql).toContain('"items"."group_id" is null')
    expect(q.sql).toContain('"items"."user_id" = $2')
    expect(q.params).toEqual(["牛乳", "user-A"])
    expect(result).toBeDefined()
    // 同期ログは更新したアイテムIDの分だけ（他ユーザーの同名アイテムIDは含まれない）
    const itemOps = state.syncOps.filter((o) => o.entity === "item")
    expect(itemOps.map((o) => o.entityId)).toEqual(["mine-milk"])
  })

  it("グループリストの完了は、グループのアイテムだけを購入済みにする（個人アイテムは対象外）", async () => {
    state.fake = createFakeDb({
      listScope: { userId: "user-A", groupId: "group-1" },
      itemIdsByName: { 牛乳: ["g-milk-1", "g-milk-2"] },
    })

    await makeService(["牛乳"]).finishShopping("list-1", "user-B")

    const [q] = itemUpdates()
    expect(q.sql).toContain('"items"."group_id" = $2')
    expect(q.sql).not.toContain("user_id")
    expect(q.params).toEqual(["牛乳", "group-1"])
    const itemOps = state.syncOps.filter((o) => o.entity === "item")
    expect(itemOps.map((o) => o.entityId)).toEqual(["g-milk-1", "g-milk-2"])
  })

  it("チェック済みアイテムごとに名前＋スコープで更新する", async () => {
    state.fake = createFakeDb({ listScope: { userId: "user-A", groupId: null } })

    await makeService(["牛乳", "パン"]).finishShopping("list-1", "user-A")

    expect(itemUpdates().map((q) => q.params)).toEqual([
      ["牛乳", "user-A"],
      ["パン", "user-A"],
    ])
  })
})
