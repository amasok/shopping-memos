// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShoppingMemosDB, type ShoppingList, type Tag } from "@/lib/db"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"
import { createClock } from "../clock"
import { createRecord, deleteRecord, updateRecord, type LocalStore } from "../repository"

const ID = "11111111-1111-4111-8111-111111111111"
const DEVICE_NOW = Date.parse("2026-11-17T10:00:00.000Z")

let database: ShoppingMemosDB

function store(queue: boolean): LocalStore {
  return { db: database, clock: createClock(5000, () => DEVICE_NOW), queue }
}

const tag = (): Omit<Tag, "updatedAt"> => ({ id: ID, name: "野菜", createdAt: new Date(DEVICE_NOW) })

beforeEach(() => {
  database = new ShoppingMemosDB(`repo-test-${crypto.randomUUID()}`)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe("ローカルのリポジトリの土台", () => {
  it("作成すると、補正済みの updatedAt で書き込み、create をキューに積む", async () => {
    const row = await createRecord<Tag>(store(true), "tags", tag(), { name: "野菜" })
    expect(row.updatedAt.toISOString()).toBe("2026-11-17T10:00:05.000Z")
    expect(await database.tags.get(ID)).toMatchObject({ name: "野菜" })
    expect(await database.syncQueue.toArray()).toEqual([
      expect.objectContaining({ entity: "tag", entityId: ID, type: "create", patch: { name: "野菜" }, clientTime: "2026-11-17T10:00:05.000Z" }),
    ])
  })

  it("更新すると updatedAt を更新し、変えたフィールドの fieldTimes つきで update を積む", async () => {
    await database.lists.add({ id: ID, name: "週末", status: "in_progress", createdAt: new Date(0) })
    await updateRecord<ShoppingList>(store(true), "lists", ID, { name: "平日" }, { name: "平日" })
    const list = await database.lists.get(ID)
    expect(list).toMatchObject({ name: "平日", updatedAt: new Date("2026-11-17T10:00:05.000Z") })
    expect(await database.syncQueue.toArray()).toEqual([
      expect.objectContaining({
        entity: "list",
        type: "update",
        patch: { name: "平日" },
        fieldTimes: { name: "2026-11-17T10:00:05.000Z" },
      }),
    ])
  })

  it("ない行の更新はエラーにし、キューに積まない", async () => {
    await expect(updateRecord<Tag>(store(true), "tags", ID, { name: "x" }, { name: "x" })).rejects.toThrow()
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("削除するとローカルから消し、delete を積む（作成が未送信なら両方消える）", async () => {
    await createRecord<Tag>(store(true), "tags", tag(), { name: "野菜" })
    await deleteRecord(store(true), "tags", ID)
    expect(await database.tags.get(ID)).toBeUndefined()
    expect(await database.syncQueue.count()).toBe(0)

    await database.items.add({ id: ID, name: "牛乳", quantity: 1, tagIds: [], createdAt: new Date(0), updatedAt: new Date(0) })
    await deleteRecord(store(true), "items", ID)
    expect(await database.syncQueue.toArray()).toEqual([expect.objectContaining({ entity: "item", type: "delete" })])
  })

  it("ゲストではキューに積まない", async () => {
    await createRecord<Tag>(store(false), "tags", tag(), { name: "野菜" })
    await updateRecord<Tag>(store(false), "tags", ID, { name: "果物" }, { name: "果物" })
    await deleteRecord(store(false), "tags", ID)
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("キューに積めなければ、エンティティの書き込みも戻す", async () => {
    const big = "あ".repeat(REQUEST_LIMITS.recordBytes)
    await expect(createRecord<Tag>(store(true), "tags", tag(), { name: big })).rejects.toThrow()
    expect(await database.tags.get(ID)).toBeUndefined()
    expect(await database.syncQueue.count()).toBe(0)
  })
})
