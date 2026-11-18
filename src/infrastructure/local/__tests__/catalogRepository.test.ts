// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ShoppingMemosDB, type SyncQueueItem } from "@/lib/db"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"
import { createPatchSchemas, updatePatchSchemas } from "@/modules/sync/application/pushPatches"
import { createClock } from "../clock"
import type { LocalStore } from "../repository"
import { createItem, createTag, deleteItem, deleteTag, updateItem, updateTag } from "../catalogRepository"

const GROUP = "22222222-2222-4222-8222-222222222222"
const DEVICE_NOW = Date.parse("2026-11-17T10:00:00.000Z")

let database: ShoppingMemosDB
let deviceNow = DEVICE_NOW

function store(queue: boolean): LocalStore {
  return { db: database, clock: createClock(5000, () => deviceNow), queue }
}

const queue = async () => (await database.syncQueue.orderBy("seq").toArray()) as SyncQueueItem[]

/** キューのパッチが sync.push の検証を通ること */
function expectValidPatch(op: SyncQueueItem) {
  const entity = op.entity as "item" | "tag"
  const schema = op.type === "create" ? createPatchSchemas[entity] : updatePatchSchemas[entity]
  expect(schema.safeParse(op.patch).success).toBe(true)
}

beforeEach(() => {
  deviceNow = DEVICE_NOW
  database = new ShoppingMemosDB(`catalog-repo-test-${crypto.randomUUID()}`)
})

afterEach(async () => {
  await database.delete()
})

describe("LocalCatalogRepository（ローカルファースト）", () => {
  it("商品を作ると行とキューの作成の操作が書かれる", async () => {
    const tag = await createTag(store(true), { name: "食品", groupId: GROUP })
    const item = await createItem(store(true), { name: "牛乳", quantity: 2, memo: "低脂肪", tagIds: [tag.id], groupId: GROUP })

    expect(await database.items.get(item.id)).toMatchObject({
      name: "牛乳",
      quantity: 2,
      memo: "低脂肪",
      tagIds: [tag.id],
      groupId: GROUP,
      createdAt: new Date("2026-11-17T10:00:05.000Z"),
      updatedAt: new Date("2026-11-17T10:00:05.000Z"),
    })
    const ops = await queue()
    const create = ops.find((o) => o.entityId === item.id)!
    expect(create).toMatchObject({
      entity: "item",
      type: "create",
      patch: { name: "牛乳", quantity: 2, memo: "低脂肪", tagIds: [tag.id], groupId: GROUP },
    })
    ops.forEach(expectValidPatch)
  })

  it("メモ・グループがなければ作成のパッチに入れない", async () => {
    const item = await createItem(store(true), { name: "卵", quantity: 1, memo: null, tagIds: [] })
    const [op] = await queue()
    expect(op.patch).toEqual({ name: "卵", quantity: 1, tagIds: [] })
    expect((await database.items.get(item.id))?.groupId).toBeUndefined()
    expectValidPatch(op)
  })

  it("商品を変えると変えたフィールドだけがキューに積まれる", async () => {
    const item = await createItem(store(true), { name: "牛乳", quantity: 1, tagIds: [] })
    await database.syncQueue.clear()
    deviceNow = DEVICE_NOW + 60_000

    await updateItem(store(true), { id: item.id, quantity: 3 })

    expect(await database.items.get(item.id)).toMatchObject({
      name: "牛乳",
      quantity: 3,
      updatedAt: new Date("2026-11-17T10:01:05.000Z"),
    })
    const [op] = await queue()
    expect(op).toMatchObject({ entity: "item", type: "update", patch: { quantity: 3 } })
    expect(op.fieldTimes).toEqual({ quantity: "2026-11-17T10:01:05.000Z" })
    expectValidPatch(op)
  })

  it("商品の更新で送るフィールドは今の tRPC の更新と同じ", async () => {
    const item = await createItem(store(true), { name: "牛乳", quantity: 1, memo: "前", tagIds: [] })
    await database.syncQueue.clear()

    await updateItem(store(true), { id: item.id, name: "豆乳", quantity: 2, memo: null, tagIds: [], groupId: GROUP })

    const [op] = await queue()
    expect(op.patch).toEqual({ name: "豆乳", quantity: 2, tagIds: [] })
    // メモの null は送らない（消せない）・groupId は変えない（今の tRPC と同じ）
    expect(await database.items.get(item.id)).toMatchObject({ name: "豆乳", memo: "前" })
    expect((await database.items.get(item.id))?.groupId).toBeUndefined()
    expectValidPatch(op)
  })

  it("変えるフィールドがない更新（メモの null だけ）は、行もキューも変えない", async () => {
    const item = await createItem(store(true), { name: "牛乳", quantity: 1, memo: "前", tagIds: [] })
    await database.syncQueue.clear()
    const before = await database.items.get(item.id)

    await updateItem(store(true), { id: item.id, memo: null })

    expect(await database.items.get(item.id)).toEqual(before)
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("商品を消すとキューに削除の操作が積まれる", async () => {
    const item = await createItem(store(true), { name: "牛乳", quantity: 1, tagIds: [] })
    // 送信済みにする（create を消して、削除が単独で積まれる状態）
    await database.syncQueue.clear()

    await deleteItem(store(true), item.id)

    expect(await database.items.get(item.id)).toBeUndefined()
    expect(await queue()).toEqual([expect.objectContaining({ entity: "item", entityId: item.id, type: "delete" })])
  })

  it("タグを作る・名前を変えるとキューに積まれる（名前の変更は作成にまとめられる）", async () => {
    const tag = await createTag(store(true), { name: "食品" })
    await updateTag(store(true), { id: tag.id, name: "食料品" })

    expect(await database.tags.get(tag.id)).toMatchObject({ name: "食料品" })
    const ops = await queue()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: "tag", type: "create", patch: { name: "食料品" } })
    expectValidPatch(ops[0])
  })

  it("タグを消すと商品のタグからも外し、商品の更新もキューに積む", async () => {
    const tag = await createTag(store(true), { name: "食品" })
    const other = await createTag(store(true), { name: "日用品" })
    const item = await createItem(store(true), { name: "牛乳", quantity: 1, tagIds: [tag.id, other.id] })
    const untagged = await createItem(store(true), { name: "卵", quantity: 1, tagIds: [other.id] })
    // どれも送信済みにする
    await database.syncQueue.clear()

    await deleteTag(store(true), tag.id)

    expect(await database.tags.get(tag.id)).toBeUndefined()
    expect((await database.items.get(item.id))?.tagIds).toEqual([other.id])
    expect((await database.items.get(untagged.id))?.tagIds).toEqual([other.id])
    const ops = await queue()
    expect(ops.map((o) => [o.entity, o.type, o.entityId])).toEqual([
      ["tag", "delete", tag.id],
      ["item", "update", item.id],
    ])
    expect(ops[1].patch).toEqual({ tagIds: [other.id] })
    expectValidPatch(ops[1])
  })

  it("送る前に作ったタグを消すと商品の作成のパッチからも外れる", async () => {
    const tag = await createTag(store(true), { name: "食品" })
    const item = await createItem(store(true), { name: "牛乳", quantity: 1, tagIds: [tag.id] })

    await deleteTag(store(true), tag.id)

    const ops = await queue()
    // タグの create + delete は圧縮で両方消え、商品の create のパッチからタグが外れる
    expect(ops.map((o) => [o.entity, o.type])).toEqual([["item", "create"]])
    expect(ops[0].patch).toMatchObject({ tagIds: [] })
    expect(ops.find((o) => o.entityId === tag.id)).toBeUndefined()
    expect((await database.items.get(item.id))?.tagIds).toEqual([])
  })

  it("キューに積めなければ行も書かない", async () => {
    const big = "あ".repeat(REQUEST_LIMITS.recordBytes)
    await expect(createItem(store(true), { name: big, quantity: 1, tagIds: [] })).rejects.toThrow()
    expect(await database.items.count()).toBe(0)
    expect(await database.syncQueue.count()).toBe(0)
  })
})

describe("LocalCatalogRepository（ゲスト）", () => {
  it("ゲストで商品を変えると更新日時が変わりキューには積まない", async () => {
    const item = await createItem(store(false), { name: "牛乳", quantity: 1, tagIds: [] })
    deviceNow = DEVICE_NOW + 60_000

    await updateItem(store(false), { id: item.id, name: "豆乳", memo: "無調整" })

    expect(await database.items.get(item.id)).toMatchObject({
      name: "豆乳",
      memo: "無調整",
      updatedAt: new Date("2026-11-17T10:01:05.000Z"),
    })
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("ゲストでタグを消すと商品のタグからも外す", async () => {
    const tag = await createTag(store(false), { name: "食品" })
    const item = await createItem(store(false), { name: "牛乳", quantity: 1, tagIds: [tag.id] })

    await deleteTag(store(false), tag.id)

    expect(await database.tags.get(tag.id)).toBeUndefined()
    expect((await database.items.get(item.id))?.tagIds).toEqual([])
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("ゲストでは今と同じく、渡したメモを空にもでき、商品を消せる", async () => {
    const item = await createItem(store(false), { name: "牛乳", quantity: 1, memo: "前", tagIds: [] })
    await updateItem(store(false), { id: item.id, memo: null })
    expect((await database.items.get(item.id))?.memo).toBeUndefined()

    await deleteItem(store(false), item.id)
    expect(await database.items.get(item.id)).toBeUndefined()
    expect(await database.syncQueue.count()).toBe(0)
  })
})
