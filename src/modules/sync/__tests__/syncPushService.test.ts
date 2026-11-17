// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getTableName, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SyncPushOperation } from "@/shared/schemas/sync"

/**
 * SyncPushService の判定（#62 O4）を、DB なしで確かめるユニットテスト
 *
 * 実際の SQL の動きは sync-push.db.test.ts（実 DB）で確かめる。ここでは、行を ID で引く小さなメモリ上の DB を使い、
 * 状態の判定（applied / partial / duplicate / conflict / rejected）と LWW の分岐を確かめる
 */
const state = vi.hoisted(() => ({
  tables: new Map<string, Map<string, Record<string, unknown>>>(),
  members: new Set<string>(),
  tagsInScope: true,
  deleted: [] as Array<[string, string]>,
  throwRowNotFound: false,
  scoped: [] as unknown[][],
}))
const recordDelete = vi.hoisted(() => (entity: string) => async (id: string) => {
  if (state.throwRowNotFound) {
    const { RowNotFoundError } = await import("@/infrastructure/db/errors")
    throw new RowNotFoundError(entity)
  }
  state.deleted.push([entity, id])
})

vi.mock("@/infrastructure/db/drizzle/client", async () => {
  const dialect = new PgDialect()
  const table = (t: unknown) => {
    const name = getTableName(t as Parameters<typeof getTableName>[0])
    if (!state.tables.has(name)) state.tables.set(name, new Map())
    return state.tables.get(name)!
  }
  // WHERE の最初のパラメータを ID として扱う（このサービスのクエリはすべて ID で引く）
  const idOf = (where: SQL) => String(dialect.sqlToQuery(where).params[0])
  const excludesDeleted = (where: SQL) => dialect.sqlToQuery(where).sql.includes('"deleted_at" is null')

  const select = () => ({
    from: (t: unknown) => ({
      where: (where: SQL) => {
        // リストのアイテムをリストの ID で引くクエリ（複合操作）
        if (dialect.sqlToQuery(where).sql.includes('"list_items"."list_id" =')) {
          const listId = idOf(where)
          const found = [...table(t).values()].filter((r) => r.listId === listId && !r.deletedAt)
          return Object.assign(Promise.resolve(found), { for: () => Promise.resolve(found) })
        }
        const row = table(t).get(idOf(where))
        const rows = row && !(excludesDeleted(where) && row.deletedAt) ? [row] : []
        return Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) })
      },
    }),
  })
  const insert = (t: unknown) => ({
    values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
      const list = Array.isArray(values) ? values : [values]
      const write = () => list.forEach((v) => v.id && table(t).set(String(v.id), { deletedAt: null, ...v }))
      return {
        onConflictDoNothing: () => ({
          returning: async () => {
            const id = String(list[0].id)
            if (table(t).has(id)) return []
            write()
            return [{ id }]
          },
        }),
        then: (resolve: (v: unknown) => unknown) => {
          write()
          return resolve(undefined)
        },
      }
    },
  })
  const update = (t: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (where: SQL) => {
        // 複数の ID（IN）の更新は、パラメータのすべての ID に当てる
        for (const id of dialect.sqlToQuery(where).params.map(String)) {
          const row = table(t).get(id)
          if (row) Object.assign(row, values)
        }
      },
    }),
  })
  const tx = {
    select,
    insert,
    update,
    delete: () => ({ where: async () => undefined }),
    execute: async () => [{ now: new Date("2026-06-01T00:00:00.000Z") }],
  }
  return { db: { ...tx, transaction: async (cb: (t: unknown) => unknown) => cb(tx) } }
})

vi.mock("@/infrastructure/db/ownership", () => ({
  canAccessScope: async (_tx: unknown, scope: { userId: string | null; groupId: string | null }, userId: string) =>
    scope.groupId ? state.members.has(`${scope.groupId}:${userId}`) : scope.userId === userId,
}))
// 完了・取り消しの I/O（shoppingCompletion）は実 DB のテスト（sync-push.db.test.ts）で確かめる。
// ここでは、規則（domain）の結果のどの計画を、どの時刻で適用に渡すかを記録する（#179）
vi.mock("@/modules/shopping/application/services/shoppingCompletion", () => ({
  readListEntries: async (_tx: unknown, listId: string) =>
    [...(state.tables.get("list_items")?.values() ?? [])]
      .filter((r) => r.listId === listId && !r.deletedAt)
      .map((r) => ({ id: r.id, name: r.name, checked: r.checked })),
  applyFinishPlan: async (_tx: unknown, list: unknown, plan: unknown, options: unknown) => {
    state.scoped.push(["finish", list, plan, options])
    return { purchasedItemIds: [], listUpdated: true }
  },
  applyRevertPlan: async (_tx: unknown, list: unknown, plan: unknown, options: unknown) => {
    state.scoped.push(["revert", list, plan, options])
    return { revertedItemIds: [], listRow: {} }
  },
}))
vi.mock("@/modules/catalog/application/services/ownership", () => ({
  areTagsInScope: async () => state.tagsInScope,
}))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository", () => ({
  itemRepository: { delete: recordDelete("item") },
}))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository", () => ({
  tagRepository: { delete: recordDelete("tag") },
}))
vi.mock("@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository", () => ({
  shoppingListRepository: { delete: recordDelete("list"), removeItem: recordDelete("listItem") },
}))

import { syncPushService } from "../application/services/SyncPushService"

const SERVER = "2026-06-01T00:00:00.000Z"
const T1 = "2026-01-01T00:00:00.000Z"
const T2 = "2026-01-02T00:00:00.000Z"
const ME = "user-me"
const OTHER = "user-other"

const op = (over: Partial<SyncPushOperation> & Pick<SyncPushOperation, "entity" | "type">): SyncPushOperation => ({
  opId: crypto.randomUUID(),
  entityId: crypto.randomUUID(),
  clientTime: T1,
  ...over,
})
const push1 = async (operation: SyncPushOperation, userId = ME) => (await syncPushService.push(userId, [operation])).results[0]
const rows = (name: string) => {
  if (!state.tables.has(name)) state.tables.set(name, new Map())
  return state.tables.get(name)!
}
const putItem = (row: Record<string, unknown>): Record<string, unknown> => {
  const full: Record<string, unknown> = { userId: ME, groupId: null, deletedAt: null, fieldModifiedAt: {}, name: "牛乳", ...row }
  rows("items").set(String(row.id), full)
  return full
}

beforeEach(() => {
  state.tables = new Map()
  state.members = new Set()
  state.tagsInScope = true
  state.deleted = []
  state.throwRowNotFound = false
  state.scoped = []
})

describe("SyncPushService: 冪等化と結果の記録", () => {
  it("serverTime を返し、操作を sync_operations に状態つきで記録する", async () => {
    const create = op({ entity: "tag", type: "create", patch: { name: "食品" } })
    const out = await syncPushService.push(ME, [create])
    expect(out).toEqual({ serverTime: SERVER, results: [{ opId: create.opId, status: "applied" }] })
    const log = rows("sync_operations").get(create.opId)!
    expect(log).toMatchObject({ userId: ME, entity: "tag", operation: "create" })
    expect(JSON.parse(String(log.payload))).toMatchObject({ status: "applied", patch: { name: "食品" } })
  })

  it("同じユーザーの opId の再送は duplicate、ほかのユーザーの opId は rejected", async () => {
    const create = op({ entity: "tag", type: "create", patch: { name: "x" } })
    await push1(create)
    expect(await push1(create)).toEqual({ opId: create.opId, status: "duplicate", reason: "applied" })
    expect(await push1(create, OTHER)).toMatchObject({ status: "rejected", reason: "op_conflict" })
  })

  it("rejected になった操作の再送は、duplicate の reason に最初の結果を返す（適用済みと取り違えない）", async () => {
    const update = op({ entity: "item", type: "update", patch: { name: "x" } })
    expect(await push1(update)).toMatchObject({ status: "rejected", reason: "not_found" })
    expect(await push1(update)).toEqual({ opId: update.opId, status: "duplicate", reason: "rejected:not_found" })
  })

  it("記録に結果がない（読めない）ときは reason なしの duplicate", async () => {
    const opId = crypto.randomUUID()
    rows("sync_operations").set(opId, { id: opId, userId: ME, payload: "not json" })
    expect(await push1(op({ opId, entity: "tag", type: "delete" }))).toEqual({ opId, status: "duplicate", reason: undefined })
  })

  it("リポジトリの RowNotFoundError は、その操作だけ rejected（not_found）にする", async () => {
    const item = putItem({ id: crypto.randomUUID() })
    state.throwRowNotFound = true
    const { results } = await syncPushService.push(ME, [
      op({ entity: "item", type: "delete", entityId: item.id as string }),
      op({ entity: "tag", type: "create", patch: { name: "続き" } }),
    ])
    expect(results.map((r) => [r.status, r.reason])).toEqual([
      ["rejected", "not_found"],
      ["applied", undefined],
    ])
  })
})

describe("SyncPushService: 作成", () => {
  it("書き込んだすべてのフィールドの時刻を、操作の時刻（未来ならサーバー時刻）にする", async () => {
    const create = op({ entity: "item", type: "create", patch: { name: "卵", tagIds: [crypto.randomUUID()] }, clientTime: "2999-01-01T00:00:00.000Z" })
    expect(await push1(create)).toMatchObject({ status: "applied" })
    const row = rows("items").get(create.entityId)!
    expect(row).toMatchObject({ name: "卵", quantity: 1, userId: ME, groupId: null })
    expect(row.fieldModifiedAt).toEqual({ name: SERVER, quantity: SERVER, memo: SERVER, tagIds: SERVER, purchasedAt: SERVER })
  })

  it("不正なパッチ・スコープ外のタグ・所属外のグループは rejected", async () => {
    expect(await push1(op({ entity: "item", type: "create", patch: { name: "" } }))).toMatchObject({ reason: "invalid_patch" })
    expect(await push1(op({ entity: "list", type: "create", patch: { name: "x", groupId: crypto.randomUUID() } }))).toMatchObject({
      reason: "forbidden",
    })
    state.tagsInScope = false
    expect(await push1(op({ entity: "item", type: "create", patch: { name: "x", tagIds: [crypto.randomUUID()] } }))).toMatchObject({
      reason: "invalid_reference",
    })
  })

  it("所属しているグループのタグ・リストを作れる", async () => {
    const group = crypto.randomUUID()
    state.members.add(`${group}:${ME}`)
    const tag = op({ entity: "tag", type: "create", patch: { name: "g", groupId: group } })
    const list = op({ entity: "list", type: "create", patch: { name: "l", groupId: group } })
    expect((await syncPushService.push(ME, [tag, list])).results.map((r) => r.status)).toEqual(["applied", "applied"])
    expect(rows("shopping_lists").get(list.entityId)).toMatchObject({ groupId: group, status: "in_progress" })
  })

  it("リストのアイテムは、使える進行中のリストにだけ、リストのグループで作る", async () => {
    const listId = crypto.randomUUID()
    const group = crypto.randomUUID()
    state.members.add(`${group}:${ME}`)
    rows("shopping_lists").set(listId, { id: listId, userId: OTHER, groupId: group, status: "in_progress", deletedAt: null })
    const li = op({ entity: "listItem", type: "create", patch: { listId, name: "パン" } })
    expect(await push1(li)).toMatchObject({ status: "applied" })
    expect(rows("list_items").get(li.entityId)).toMatchObject({ groupId: group, userId: ME, listId })

    expect(await push1(op({ entity: "listItem", type: "create", patch: { listId, name: "x" } }), OTHER)).toMatchObject({
      reason: "invalid_reference",
    })
    expect(await push1(op({ entity: "listItem", type: "create", patch: { listId: crypto.randomUUID(), name: "x" } }))).toMatchObject({
      reason: "invalid_reference",
    })
    state.tagsInScope = false
    expect(await push1(op({ entity: "listItem", type: "create", patch: { listId, name: "x", tagIds: [crypto.randomUUID()] } }))).toMatchObject({
      reason: "invalid_reference",
    })
    rows("shopping_lists").get(listId)!.status = "completed"
    expect(await push1(op({ entity: "listItem", type: "create", patch: { listId, name: "x" } }))).toMatchObject({
      reason: "list_completed",
    })
  })

  it("同じ ID の行: 自分のものなら更新として扱い、他人のものなら rejected、削除済みなら conflict", async () => {
    const mine = putItem({ id: crypto.randomUUID(), fieldModifiedAt: { name: T1 } })
    expect(await push1(op({ entity: "item", type: "create", entityId: mine.id as string, patch: { name: "豆乳" }, clientTime: T2 }))).toMatchObject({
      status: "applied",
    })
    expect(mine.name).toBe("豆乳")

    const foreign = putItem({ id: crypto.randomUUID(), userId: OTHER })
    const result = await push1(op({ entity: "item", type: "create", entityId: foreign.id as string, patch: { name: "x" } }))
    expect(result).toMatchObject({ status: "rejected", reason: "id_conflict" })
    expect(result.serverRow).toBeUndefined()

    const gone = putItem({ id: crypto.randomUUID(), deletedAt: new Date() })
    expect(await push1(op({ entity: "item", type: "create", entityId: gone.id as string, patch: { name: "x" } }))).toMatchObject({
      status: "conflict",
      reason: "deleted",
    })
  })
})

describe("SyncPushService: 更新（フィールド単位の LWW）", () => {
  it("purchasedAt の値も、未来ならサーバー時刻に丸める", async () => {
    const row = putItem({ id: crypto.randomUUID() })
    await push1(op({ entity: "item", type: "update", entityId: row.id as string, patch: { purchasedAt: "2999-01-01T00:00:00.000Z" } }))
    expect(row.purchasedAt).toEqual(new Date(SERVER))
    await push1(op({ entity: "item", type: "update", entityId: row.id as string, patch: { purchasedAt: null }, clientTime: T2 }))
    expect(row.purchasedAt).toBeNull()
    const create = op({ entity: "item", type: "create", patch: { name: "x", purchasedAt: "2999-01-01T00:00:00.000Z" } })
    await push1(create)
    expect(rows("items").get(create.entityId)!.purchasedAt).toEqual(new Date(SERVER))
  })

  it("キーがないフィールドは常に適用し、時刻を記録する", async () => {
    const row = putItem({ id: crypto.randomUUID() })
    expect(await push1(op({ entity: "item", type: "update", entityId: row.id as string, patch: { memo: "m", purchasedAt: T1 } }))).toMatchObject({
      status: "applied",
    })
    expect(row).toMatchObject({ memo: "m", purchasedAt: new Date(T1), fieldModifiedAt: { memo: T1, purchasedAt: T1 } })
  })

  it("古いフィールドだけを捨てて partial にし、serverRow（アイテムは tagIds つき）を返す", async () => {
    const row = putItem({ id: crypto.randomUUID(), fieldModifiedAt: { name: T2 } })
    const result = await push1(
      op({ entity: "item", type: "update", entityId: row.id as string, patch: { name: "古い", quantity: 3 }, fieldTimes: { name: T1 }, clientTime: T2 })
    )
    expect(result.status).toBe("partial")
    expect(result.serverRow).toMatchObject({ name: "牛乳", quantity: 3, tagIds: [] })
    expect(row.fieldModifiedAt).toEqual({ name: T2, quantity: T2 })
  })

  it("すべてのフィールドが古ければ何も書かず partial", async () => {
    const row = putItem({ id: crypto.randomUUID(), fieldModifiedAt: { name: T2 } })
    const result = await push1(op({ entity: "item", type: "update", entityId: row.id as string, patch: { name: "古い" }, clientTime: T1 }))
    expect(result.status).toBe("partial")
    expect(row.name).toBe("牛乳")
  })

  it("存在しない行・他人の行は rejected（not_found）、削除済みは conflict、不正なパッチは rejected", async () => {
    expect(await push1(op({ entity: "item", type: "update", patch: { name: "x" } }))).toMatchObject({ reason: "not_found" })
    const foreign = putItem({ id: crypto.randomUUID(), userId: OTHER })
    expect(await push1(op({ entity: "item", type: "update", entityId: foreign.id as string, patch: { name: "x" } }))).toMatchObject({
      reason: "not_found",
    })
    const gone = putItem({ id: crypto.randomUUID(), deletedAt: new Date() })
    expect(await push1(op({ entity: "item", type: "update", entityId: gone.id as string, patch: { name: "x" } }))).toMatchObject({
      status: "conflict",
    })
    const mine = putItem({ id: crypto.randomUUID() })
    expect(await push1(op({ entity: "item", type: "update", entityId: mine.id as string, patch: { groupId: null } }))).toMatchObject({
      reason: "invalid_patch",
    })
  })

  it("アイテムのタグはスコープ内のものだけ", async () => {
    const row = putItem({ id: crypto.randomUUID() })
    state.tagsInScope = false
    expect(await push1(op({ entity: "item", type: "update", entityId: row.id as string, patch: { tagIds: [crypto.randomUUID()] } }))).toMatchObject({
      reason: "invalid_reference",
    })
    state.tagsInScope = true
    expect(await push1(op({ entity: "item", type: "update", entityId: row.id as string, patch: { tagIds: [] } }))).toMatchObject({
      status: "applied",
    })
  })

  it("リストのアイテムのチェックは、親のリストで判定し、完了したリストでは rejected", async () => {
    const listId = crypto.randomUUID()
    rows("shopping_lists").set(listId, { id: listId, userId: ME, groupId: null, status: "in_progress", deletedAt: null })
    const liId = crypto.randomUUID()
    rows("list_items").set(liId, { id: liId, listId, userId: null, groupId: null, deletedAt: null, fieldModifiedAt: {}, checked: false })
    expect(await push1(op({ entity: "listItem", type: "update", entityId: liId, patch: { checked: true } }))).toMatchObject({
      status: "applied",
    })
    expect(rows("list_items").get(liId)!.checked).toBe(true)
    expect(await push1(op({ entity: "listItem", type: "update", entityId: liId, patch: { checked: false } }), OTHER)).toMatchObject({
      reason: "not_found",
    })
    rows("shopping_lists").get(listId)!.status = "completed"
    expect(await push1(op({ entity: "listItem", type: "update", entityId: liId, patch: { checked: false } }))).toMatchObject({
      reason: "list_completed",
    })
  })
})

describe("SyncPushService: 親のリストが削除済みのリストのアイテム", () => {
  it("削除済みと同じに扱う（update は conflict、delete は何もせず applied）", async () => {
    const listId = crypto.randomUUID()
    rows("shopping_lists").set(listId, { id: listId, userId: ME, groupId: null, status: "in_progress", deletedAt: new Date() })
    const liId = crypto.randomUUID()
    rows("list_items").set(liId, { id: liId, listId, deletedAt: null, fieldModifiedAt: {}, checked: false })
    expect(await push1(op({ entity: "listItem", type: "update", entityId: liId, patch: { checked: true } }))).toMatchObject({
      status: "conflict",
      reason: "deleted",
    })
    expect(await push1(op({ entity: "listItem", type: "delete", entityId: liId }))).toMatchObject({ status: "applied" })
    expect(state.deleted).toEqual([])
    expect(rows("list_items").get(liId)!.checked).toBe(false)
  })
})

describe("SyncPushService: 削除", () => {
  it("エンティティごとのリポジトリで論理削除し、削除済みなら何もせず applied", async () => {
    const item = putItem({ id: crypto.randomUUID() })
    const tagId = crypto.randomUUID()
    rows("tags").set(tagId, { id: tagId, userId: ME, groupId: null, deletedAt: null })
    const listId = crypto.randomUUID()
    rows("shopping_lists").set(listId, { id: listId, userId: ME, groupId: null, status: "in_progress", deletedAt: null })
    const liId = crypto.randomUUID()
    rows("list_items").set(liId, { id: liId, listId, deletedAt: null })
    const gone = putItem({ id: crypto.randomUUID(), deletedAt: new Date() })

    const { results } = await syncPushService.push(ME, [
      op({ entity: "item", type: "delete", entityId: item.id as string }),
      op({ entity: "tag", type: "delete", entityId: tagId }),
      op({ entity: "listItem", type: "delete", entityId: liId }),
      op({ entity: "list", type: "delete", entityId: listId }),
      op({ entity: "item", type: "delete", entityId: gone.id as string }),
    ])
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied", "applied"])
    expect(state.deleted).toEqual([
      ["item", item.id],
      ["tag", tagId],
      ["listItem", liId],
      ["list", listId],
    ])
  })

  it("存在しない行・他人の行は rejected、完了したリストのアイテムは消さない", async () => {
    expect(await push1(op({ entity: "item", type: "delete" }))).toMatchObject({ reason: "not_found" })
    const foreign = putItem({ id: crypto.randomUUID(), userId: OTHER })
    expect(await push1(op({ entity: "item", type: "delete", entityId: foreign.id as string }))).toMatchObject({ reason: "not_found" })

    const listId = crypto.randomUUID()
    rows("shopping_lists").set(listId, { id: listId, userId: ME, groupId: null, status: "completed", deletedAt: null })
    const liId = crypto.randomUUID()
    rows("list_items").set(liId, { id: liId, listId, deletedAt: null })
    expect(await push1(op({ entity: "listItem", type: "delete", entityId: liId }))).toMatchObject({ reason: "list_completed" })
    expect(state.deleted).toEqual([])
  })
})

describe("SyncPushService: 複合操作（#62 O4b）", () => {
  const putList = (row: Record<string, unknown>) => {
    const full: Record<string, unknown> = {
      userId: ME, groupId: null, status: "in_progress", purchasedAt: null, deletedAt: null, fieldModifiedAt: {}, ...row,
    }
    rows("shopping_lists").set(String(row.id), full)
    return full
  }
  const putListItem = (listId: string, name: string, checked: boolean) => {
    const id = crypto.randomUUID()
    rows("list_items").set(id, { id, listId, name, checked, deletedAt: null })
    return rows("list_items").get(id)!
  }

  it("完了: チェック済みの名前・未チェックの ID・完了の状態の計画を、操作の時刻で適用に渡す", async () => {
    const list = putList({ id: crypto.randomUUID() })
    putListItem(list.id as string, "牛乳", true)
    const egg = putListItem(list.id as string, "卵", false)
    const result = await push1(op({ entity: "list", type: "finishShopping", entityId: list.id as string, patch: { location: "店" }, clientTime: T2 }))
    expect(result).toMatchObject({ status: "applied" })
    expect(state.scoped).toEqual([
      [
        "finish",
        { id: list.id, userId: ME, groupId: null, status: "in_progress", purchasedAt: null },
        {
          ok: true,
          purchaseNames: ["牛乳"],
          removeEntryIds: [egg.id],
          listState: { status: "completed", completedAt: new Date(T2), purchasedAt: new Date(T2), location: "店" },
        },
        { opTime: T2 },
      ],
    ])
  })

  it("完了: チェック 0 件でも完了の計画を適用に渡す（今のサーバーの振る舞い）", async () => {
    const list = putList({ id: crypto.randomUUID() })
    const milk = putListItem(list.id as string, "牛乳", false)
    expect(await push1(op({ entity: "list", type: "finishShopping", entityId: list.id as string, clientTime: T2 }))).toMatchObject({
      status: "applied",
    })
    expect(state.scoped[0][2]).toMatchObject({ ok: true, purchaseNames: [], removeEntryIds: [milk.id] })
  })

  it("取り消し: リストのアイテムの名前と進行中の状態の計画を、操作の時刻で適用に渡す", async () => {
    const list = putList({ id: crypto.randomUUID(), status: "completed", purchasedAt: new Date(T1), fieldModifiedAt: { status: T1, name: T1 } })
    putListItem(list.id as string, "牛乳", true)
    expect(await push1(op({ entity: "list", type: "revertHistory", entityId: list.id as string, clientTime: T2 }))).toMatchObject({
      status: "applied",
    })
    expect(state.scoped).toEqual([
      [
        "revert",
        { id: list.id, userId: ME, groupId: null, status: "completed", purchasedAt: new Date(T1) },
        {
          ok: true,
          revertNames: ["牛乳"],
          listState: { status: "in_progress", completedAt: null, purchasedAt: null, location: null },
        },
        { opTime: T2 },
      ],
    ])
  })

  it("取り消しの stale: 購入日時が入っているリストで、状態が操作の時刻より新しければ conflict", async () => {
    const list = putList({ id: crypto.randomUUID(), status: "completed", purchasedAt: new Date(T1), fieldModifiedAt: { status: T2 } })
    expect(await push1(op({ entity: "list", type: "revertHistory", entityId: list.id as string, clientTime: T1 }))).toMatchObject({
      status: "conflict",
      reason: "stale",
    })
    expect(state.scoped).toEqual([])
  })

  it("完了済みの完了・未完了の取り消し・新しい状態がある古い操作は conflict", async () => {
    const done = putList({ id: crypto.randomUUID(), status: "completed", purchasedAt: new Date(T1) })
    expect(await push1(op({ entity: "list", type: "finishShopping", entityId: done.id as string }))).toMatchObject({
      status: "conflict",
      reason: "already_completed",
    })
    const open = putList({ id: crypto.randomUUID() })
    expect(await push1(op({ entity: "list", type: "revertHistory", entityId: open.id as string }))).toMatchObject({
      status: "conflict",
      reason: "not_completed",
    })
    const reverted = putList({ id: crypto.randomUUID(), fieldModifiedAt: { status: T2 } })
    const late = await push1(op({ entity: "list", type: "finishShopping", entityId: reverted.id as string, clientTime: T1 }))
    expect(late).toMatchObject({ status: "conflict", reason: "stale", serverRow: { id: reverted.id } })
    expect(reverted.status).toBe("in_progress")
    expect(state.scoped).toEqual([])
  })

  it("リスト以外・不正なパッチ・使えないリスト・削除済みのリストには適用しない", async () => {
    const item = putItem({ id: crypto.randomUUID() })
    expect(await push1(op({ entity: "item", type: "finishShopping", entityId: item.id as string }))).toMatchObject({ reason: "invalid_patch" })
    const list = putList({ id: crypto.randomUUID() })
    expect(await push1(op({ entity: "list", type: "revertHistory", entityId: list.id as string, patch: { x: 1 } }))).toMatchObject({
      reason: "invalid_patch",
    })
    expect(await push1(op({ entity: "list", type: "finishShopping", entityId: list.id as string }), OTHER)).toMatchObject({
      reason: "not_found",
    })
    const gone = putList({ id: crypto.randomUUID(), deletedAt: new Date() })
    expect(await push1(op({ entity: "list", type: "finishShopping", entityId: gone.id as string }))).toMatchObject({
      status: "conflict",
      reason: "deleted",
    })
  })
})
