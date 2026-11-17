// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ShoppingMemosDB, type SyncQueueItem } from "@/lib/db"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"
import { QueueLimitError, enqueue, mergePatches, planEnqueue, type NewOperation } from "../syncQueue"

const ID = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const T1 = "2026-11-17T10:00:00.000Z"
const T2 = "2026-11-17T10:00:05.000Z"
const T3 = "2026-11-17T10:00:09.000Z"

function queued(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: "op-1",
    seq: 1,
    entity: "item",
    entityId: ID,
    type: "update",
    patch: { name: "牛乳" },
    fieldTimes: { name: T1 },
    clientTime: T1,
    retryCount: 0,
    status: "pending",
    ...overrides,
  }
}

const update = (patch: Record<string, unknown>, time = T2): NewOperation => ({
  entity: "item",
  entityId: ID,
  type: "update",
  patch,
  fieldTimes: Object.fromEntries(Object.keys(patch).map((k) => [k, time])),
  clientTime: time,
})
const del = (time = T2): NewOperation => ({ entity: "item", entityId: ID, type: "delete", clientTime: time })

describe("planEnqueue（キューの圧縮）", () => {
  it("create + update は、パッチを統合した create になる", () => {
    const plan = planEnqueue(queued({ type: "create", patch: { name: "牛乳", quantity: 1 }, fieldTimes: undefined }), update({ quantity: 2 }))
    expect(plan).toEqual({
      kind: "merge",
      merged: { type: "create", patch: { name: "牛乳", quantity: 2 }, fieldTimes: { name: T1, quantity: T2 }, clientTime: T2 },
    })
  })

  it("update + update は、統合した update になる", () => {
    const plan = planEnqueue(queued(), update({ memo: "低脂肪" }))
    expect(plan).toEqual({
      kind: "merge",
      merged: { type: "update", patch: { name: "牛乳", memo: "低脂肪" }, fieldTimes: { name: T1, memo: T2 }, clientTime: T2 },
    })
  })

  it("create + delete は両方消す", () => {
    expect(planEnqueue(queued({ type: "create" }), del())).toEqual({ kind: "dropBoth" })
  })

  it("update + delete は delete だけを積む", () => {
    expect(planEnqueue(queued(), del())).toEqual({ kind: "replace" })
  })

  it("送信中（inflight）の操作は圧縮しない", () => {
    expect(planEnqueue(queued({ type: "create", status: "inflight" }), del())).toEqual({ kind: "append" })
    expect(planEnqueue(queued({ status: "inflight" }), update({ name: "豆乳" }))).toEqual({ kind: "append" })
  })

  it("failed の操作・複合操作・前の操作がないときはそのまま積む", () => {
    expect(planEnqueue(queued({ status: "failed" }), update({ name: "豆乳" }))).toEqual({ kind: "append" })
    expect(planEnqueue(queued({ entity: "list", type: "finishShopping" }), update({ name: "x" }))).toEqual({ kind: "append" })
    expect(planEnqueue(undefined, update({ name: "x" }))).toEqual({ kind: "append" })
    expect(planEnqueue(queued({ type: "delete" }), update({ name: "x" }))).toEqual({ kind: "append" })
  })
})

describe("mergePatches", () => {
  it("fieldTimes はフィールドごとに新しい方を残し、clientTime は新しい方にする", () => {
    const merged = mergePatches(
      { patch: { name: "A", memo: "m1" }, fieldTimes: { name: T3, memo: T1 }, clientTime: T3 },
      { patch: { name: "B", memo: "m2" }, fieldTimes: { name: T2, memo: T2 }, clientTime: T2 }
    )
    expect(merged).toEqual({ patch: { name: "A", memo: "m2" }, fieldTimes: { name: T3, memo: T2 }, clientTime: T3 })
  })

  it("fieldTimes がないフィールドは clientTime で比べる", () => {
    const merged = mergePatches({ patch: { name: "A" }, clientTime: T1 }, { patch: { name: "B" }, clientTime: T2 })
    expect(merged).toEqual({ patch: { name: "B" }, fieldTimes: { name: T2 }, clientTime: T2 })
  })
})

describe("enqueue（Dexie）", () => {
  let database: ShoppingMemosDB

  beforeEach(() => {
    database = new ShoppingMemosDB(`queue-test-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await database.delete()
  })

  const all = () => database.syncQueue.orderBy("seq").toArray()

  it("積んだ順に seq を振り、pending で積む", async () => {
    await enqueue(database, update({ name: "A" }))
    await enqueue(database, { ...update({ name: "B" }), entityId: OTHER })
    const ops = await all()
    expect(ops.map((op) => [op.entityId, op.seq, op.status, op.retryCount])).toEqual([
      [ID, 1, "pending", 0],
      [OTHER, 2, "pending", 0],
    ])
  })

  it("同じエンティティの update は 1 件にまとまり、別のエンティティはまとめない", async () => {
    await enqueue(database, update({ name: "A" }, T1))
    await enqueue(database, { ...update({ name: "X" }), entityId: OTHER })
    await enqueue(database, update({ quantity: 3 }, T3))
    const ops = await all()
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ entityId: ID, seq: 1, patch: { name: "A", quantity: 3 }, clientTime: T3 })
  })

  it("同じ ID でもエンティティが違えばまとめない", async () => {
    await enqueue(database, update({ name: "A" }))
    await enqueue(database, { ...update({ name: "B" }), entity: "tag" })
    expect(await all()).toHaveLength(2)
  })

  it("create の後の delete で、キューが空になる", async () => {
    await enqueue(database, { ...update({ name: "A" }), type: "create" })
    await enqueue(database, del())
    expect(await all()).toEqual([])
  })

  it("update の後の delete は、delete を最後に積み直す", async () => {
    await enqueue(database, update({ name: "A" }))
    await enqueue(database, { ...update({ name: "X" }), entityId: OTHER })
    await enqueue(database, del())
    const ops = await all()
    expect(ops.map((op) => [op.entityId, op.type])).toEqual([
      [OTHER, "update"],
      [ID, "delete"],
    ])
  })

  it("送信中の create の後の delete は、新しい操作として残る", async () => {
    await enqueue(database, { ...update({ name: "A" }), type: "create" })
    await database.syncQueue.toCollection().modify({ status: "inflight" })
    await enqueue(database, del())
    expect((await all()).map((op) => [op.type, op.status])).toEqual([
      ["create", "inflight"],
      ["delete", "pending"],
    ])
  })

  it("パッチが上限を超えると積まない", async () => {
    const big = "あ".repeat(REQUEST_LIMITS.recordBytes)
    await expect(enqueue(database, update({ memo: big }))).rejects.toBeInstanceOf(QueueLimitError)
    expect(await all()).toEqual([])
  })

  it("fieldTimes のキーが上限を超えると積まない", async () => {
    const patch = Object.fromEntries(Array.from({ length: REQUEST_LIMITS.pushFieldTimes + 1 }, (_, i) => [`f${i}`, i]))
    await expect(enqueue(database, update(patch))).rejects.toThrow("fieldTimes")
  })

  it("まとめた結果が上限を超えると、まとめずに失敗する（前の操作は残る）", async () => {
    const half = "a".repeat(REQUEST_LIMITS.recordBytes / 2 + 10)
    await enqueue(database, update({ name: half }))
    await expect(enqueue(database, update({ memo: half }))).rejects.toBeInstanceOf(QueueLimitError)
    expect((await all())[0].patch).toEqual({ name: half })
  })
})
