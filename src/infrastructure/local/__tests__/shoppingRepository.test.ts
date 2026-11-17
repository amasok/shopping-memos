// @vitest-environment node
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ShoppingMemosDB, type ShoppingItem, type SyncQueueItem } from "@/lib/db"
import { compoundPatchSchemas, createPatchSchemas, updatePatchSchemas } from "@/modules/sync/application/pushPatches"
import { createClock } from "../clock"
import type { LocalStore } from "../repository"
import {
  addItemToList,
  addNewItemToList,
  checkItem,
  createList,
  deleteHistory,
  deleteList,
  finishShopping,
  removeItemFromList,
  revertHistory,
} from "../shoppingRepository"

const GROUP = "22222222-2222-4222-8222-222222222222"
const TAG = "33333333-3333-4333-8333-333333333333"
const NOW = Date.parse("2026-11-17T10:00:00.000Z")
const BEFORE = new Date("2026-11-01T00:00:00.000Z")

let database: ShoppingMemosDB

const store = (queue: boolean): LocalStore => ({ db: database, clock: createClock(0, () => NOW), queue })
const local = () => store(true)
const guest = () => store(false)
const queue = async () => (await database.syncQueue.orderBy("seq").toArray()) as SyncQueueItem[]
const ops = async () => (await queue()).map((o) => [o.entity, o.type, o.entityId])

/** キューのパッチが sync.push の検証を通ること */
function expectValidPatches(items: SyncQueueItem[]) {
  for (const op of items) {
    if (op.type === "delete") continue
    const schema =
      op.type === "create"
        ? createPatchSchemas[op.entity]
        : op.type === "update"
          ? updatePatchSchemas[op.entity]
          : compoundPatchSchemas[op.type]
    expect(schema.safeParse(op.patch ?? {}).success, `${op.entity} ${op.type}`).toBe(true)
  }
}

async function catalog(name: string, over: Partial<ShoppingItem> = {}) {
  const item: ShoppingItem = {
    id: crypto.randomUUID(),
    name,
    quantity: 1,
    tagIds: [],
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...over,
  }
  await database.items.add(item)
  return item
}

/** 送信済みにする（キューを空にする） */
const sent = () => database.syncQueue.clear()

beforeEach(() => {
  database = new ShoppingMemosDB(`shopping-repo-test-${crypto.randomUUID()}`)
})

afterEach(async () => {
  await database.delete()
})

describe("リストと商品の書き込み", () => {
  it("カタログの商品を選んでリストを作るとスナップショットが入る", async () => {
    const milk = await catalog("牛乳", { quantity: 2, memo: "低脂肪", tagIds: [TAG], groupId: GROUP })

    const list = await createList(local(), { name: "買い物", groupId: GROUP, itemIds: [milk.id] })

    const entries = await database.listItems.where("listId").equals(list.id).toArray()
    expect(entries).toEqual([
      expect.objectContaining({ name: "牛乳", quantity: 2, memo: "低脂肪", tagIds: [TAG], groupId: GROUP, checked: false }),
    ])
    const q = await queue()
    expect(q.map((o) => [o.entity, o.type])).toEqual([
      ["list", "create"],
      ["listItem", "create"],
    ])
    expect(q[0].patch).toEqual({ name: "買い物", groupId: GROUP })
    expect(q[1].patch).toEqual({ listId: list.id, name: "牛乳", quantity: 2, memo: "低脂肪", tagIds: [TAG], checked: false })
    expectValidPatches(q)
  })

  it("端末にない商品は飛ばし、グループの違う商品はエラーにする", async () => {
    const personal = await catalog("個人の牛乳")
    const list = await createList(local(), { name: "買い物", itemIds: [crypto.randomUUID(), personal.id] })
    expect(await database.listItems.where("listId").equals(list.id).count()).toBe(1)

    await expect(createList(local(), { name: "グループ", groupId: GROUP, itemIds: [personal.id] })).rejects.toThrow("権限がありません")
  })

  it("タグを選んでリストを作ると同じグループの未購入のタグ付きの商品が入る", async () => {
    await catalog("牛乳", { tagIds: ["tag-x"] })
    await catalog("購入済み", { tagIds: ["tag-x"], purchasedAt: BEFORE })
    await catalog("グループ", { tagIds: ["tag-x"], groupId: GROUP })
    await catalog("タグなし")

    const list = await createList(local(), { name: "買い物", tagIds: ["tag-x"] })

    const names = (await database.listItems.where("listId").equals(list.id).toArray()).map((e) => e.name)
    expect(names).toEqual(["牛乳"])
  })

  it("新しい商品をリストに入れるとカタログにも作る", async () => {
    const list = await createList(local(), { name: "買い物", groupId: GROUP })
    await sent()

    const entry = await addNewItemToList(local(), { listId: list.id, name: "卵", quantity: 6, tagIds: [] })

    const items = await database.items.toArray()
    expect(items).toEqual([expect.objectContaining({ name: "卵", quantity: 6, groupId: GROUP })])
    expect(entry).toMatchObject({ name: "卵", quantity: 6, groupId: GROUP, checked: false })
    const q = await queue()
    expect(q.map((o) => [o.entity, o.type])).toEqual([
      ["item", "create"],
      ["listItem", "create"],
    ])
    expectValidPatches(q)
  })

  it("商品をチェックするとチェックだけをキューに積む", async () => {
    const milk = await catalog("牛乳")
    const list = await createList(local(), { name: "買い物", itemIds: [milk.id] })
    const [entry] = await database.listItems.toArray()
    await sent()

    await checkItem(local(), entry.id, true)

    expect((await database.listItems.get(entry.id))?.checked).toBe(true)
    const q = await queue()
    expect(q).toEqual([expect.objectContaining({ entity: "listItem", type: "update", entityId: entry.id, patch: { checked: true } })])
    expectValidPatches(q)
    expect(list.id).toBeDefined()
  })

  it("リストから商品を外すとキューに削除を積む", async () => {
    const milk = await catalog("牛乳")
    await createList(local(), { name: "買い物", itemIds: [milk.id] })
    const [entry] = await database.listItems.toArray()
    await sent()

    await removeItemFromList(local(), entry.id)

    expect(await database.listItems.count()).toBe(0)
    expect(await ops()).toEqual([["listItem", "delete", entry.id]])
  })

  it("進行中のリストを消すとリストの商品も消しキューに削除を積む", async () => {
    const milk = await catalog("牛乳")
    const egg = await catalog("卵")
    const list = await createList(local(), { name: "買い物", itemIds: [milk.id, egg.id] })
    const entries = await database.listItems.toArray()
    await sent()

    await deleteList(local(), list.id)

    expect(await database.lists.count()).toBe(0)
    expect(await database.listItems.count()).toBe(0)
    const q = await ops()
    expect(q.slice(0, 2).map(([e, t]) => [e, t])).toEqual([
      ["listItem", "delete"],
      ["listItem", "delete"],
    ])
    expect(new Set(q.slice(0, 2).map((o) => o[2]))).toEqual(new Set(entries.map((e) => e.id)))
    expect(q[2]).toEqual(["list", "delete", list.id])
  })

  it("送る前に作ったリストを消すとキューに何も残らない", async () => {
    const milk = await catalog("牛乳")
    const list = await createList(local(), { name: "買い物", itemIds: [milk.id] })
    await addNewItemToList(local(), { listId: list.id, name: "卵" })
    // 商品の作成（カタログ）は残る。リストとリストの商品の操作だけが消える
    await deleteList(local(), list.id)

    expect((await queue()).filter((o) => o.entity === "list" || o.entity === "listItem")).toEqual([])
  })

  it("ローカルファーストでは端末の DB で消してキューに削除を積む", async () => {
    const milk = await catalog("牛乳", { groupId: GROUP })
    const purchased = await catalog("牛乳", { groupId: GROUP, purchasedAt: BEFORE })
    const otherGroup = await catalog("牛乳")
    const list = await createList(local(), { name: "買い物", groupId: GROUP, itemIds: [milk.id] })
    const [entry] = await database.listItems.toArray()
    await sent()

    await deleteList(local(), list.id, { deleteCatalogItems: true })

    expect(await database.lists.count()).toBe(0)
    expect(await database.listItems.count()).toBe(0)
    expect(await database.items.get(milk.id)).toBeUndefined()
    expect(await database.items.get(purchased.id)).toBeDefined()
    expect(await database.items.get(otherGroup.id)).toBeDefined()
    expect(await ops()).toEqual([
      ["item", "delete", milk.id],
      ["listItem", "delete", entry.id],
      ["list", "delete", list.id],
    ])
  })

  it("指定しないとリストだけを消す（端末の DB）", async () => {
    const milk = await catalog("牛乳")
    const list = await createList(local(), { name: "買い物", itemIds: [milk.id] })
    await sent()

    await deleteList(local(), list.id, { deleteCatalogItems: false })

    expect(await database.lists.count()).toBe(0)
    expect(await database.items.get(milk.id)).toBeDefined()
    expect((await ops()).some(([e]) => e === "item")).toBe(false)
  })

  it("完了したリストには商品を入れられない", async () => {
    const milk = await catalog("牛乳")
    const list = await createList(local(), { name: "買い物", itemIds: [milk.id] })
    const [entry] = await database.listItems.toArray()
    await checkItem(local(), entry.id, true)
    await finishShopping(local(), list.id, undefined)
    const before = await queue()

    await expect(addItemToList(local(), { listId: list.id, itemId: milk.id })).rejects.toThrow("完了したリスト")
    await expect(addNewItemToList(local(), { listId: list.id, name: "卵" })).rejects.toThrow("完了したリスト")
    await expect(checkItem(local(), entry.id, false)).rejects.toThrow("完了したリスト")
    await expect(removeItemFromList(local(), entry.id)).rejects.toThrow("完了したリスト")
    expect(await queue()).toEqual(before)
    expect(await database.listItems.get(entry.id)).toMatchObject({ checked: true })
  })
})

describe("完了・取り消し・削除（ローカルファースト）", () => {
  async function shoppingList(entries: Array<{ name: string; checked: boolean }>, groupId?: string) {
    const list = await createList(local(), { name: "買い物", groupId })
    for (const e of entries) {
      const entry = await addNewItemToList(local(), { listId: list.id, name: e.name })
      if (e.checked) await checkItem(local(), entry.id, true)
    }
    await sent()
    return list
  }

  it("ローカルファーストの完了は端末の DB を更新し複合操作を 1 つ積む", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: true }, { name: "卵", checked: false }], GROUP)

    await finishShopping(local(), list.id, "スーパー")

    const at = new Date(NOW)
    expect((await database.items.filter((i) => i.name === "牛乳").first())?.purchasedAt).toEqual(at)
    expect((await database.items.filter((i) => i.name === "卵").first())?.purchasedAt).toBeUndefined()
    expect((await database.listItems.where("listId").equals(list.id).toArray()).map((e) => e.name)).toEqual(["牛乳"])
    expect(await database.lists.get(list.id)).toMatchObject({ status: "completed", completedAt: at, purchasedAt: at, location: "スーパー" })
    const q = await queue()
    expect(q).toEqual([expect.objectContaining({ entity: "list", type: "finishShopping", entityId: list.id, patch: { location: "スーパー" } })])
    expectValidPatches(q)
  })

  it("ローカルファーストの完了は同じ名前の購入済みの商品の購入日時を変えない", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: true }])
    const old = await catalog("牛乳", { purchasedAt: BEFORE })

    await finishShopping(local(), list.id, undefined)

    const fresh = await database.items.filter((i) => i.name === "牛乳" && i.id !== old.id).first()
    expect(fresh?.purchasedAt).toEqual(new Date(NOW))
    expect((await database.items.get(old.id))?.purchasedAt).toEqual(BEFORE)
  })

  it("ローカルファーストではチェック 0 件で完了するとエラーになる", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: false }])
    const before = await database.items.toArray()

    await expect(finishShopping(local(), list.id, undefined)).rejects.toThrow("購入済みのアイテムがありません")

    expect((await database.lists.get(list.id))?.status).toBe("in_progress")
    expect(await database.listItems.where("listId").equals(list.id).count()).toBe(1)
    expect(await database.items.toArray()).toEqual(before)
    expect(await queue()).toEqual([])
  })

  it("完了済みのリストは端末の DB でも完了できない", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: true }])
    await finishShopping(local(), list.id, undefined)
    await sent()

    await expect(finishShopping(local(), list.id, undefined)).rejects.toThrow("このリストは既に完了しています")
    expect(await queue()).toEqual([])
  })

  it("ローカルファーストの取り消しは端末の DB を戻し複合操作を 1 つ積む", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: true }], GROUP)
    await finishShopping(local(), list.id, "店")
    await sent()

    const result = await revertHistory(local(), list.id)

    const milk = await database.items.filter((i) => i.name === "牛乳").first()
    expect(milk?.purchasedAt).toBeUndefined()
    expect(result.revertedItemIds).toEqual([milk?.id])
    const row = await database.lists.get(list.id)
    expect(row).toMatchObject({ status: "in_progress" })
    expect(row?.completedAt).toBeUndefined()
    expect(row?.purchasedAt).toBeUndefined()
    expect(row?.location).toBeUndefined()
    const q = await queue()
    expect(q).toEqual([expect.objectContaining({ entity: "list", type: "revertHistory", entityId: list.id })])
    expectValidPatches(q)
  })

  it("購入履歴でないリストは端末の DB でも取り消せない", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: true }])

    await expect(revertHistory(local(), list.id)).rejects.toThrow("この履歴は既にリストに戻っています")
    expect(await queue()).toEqual([])
  })

  it("履歴を削除すると同じ名前のカタログの商品も消す", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: true }], GROUP)
    await finishShopping(local(), list.id, undefined)
    const otherGroupMilk = await catalog("牛乳")
    const entries = await database.listItems.where("listId").equals(list.id).toArray()
    const milk = await database.items.filter((i) => i.name === "牛乳" && i.groupId === GROUP).first()
    await sent()

    await deleteHistory(local(), list.id)

    expect(await database.lists.get(list.id)).toBeUndefined()
    expect(await database.listItems.where("listId").equals(list.id).count()).toBe(0)
    expect(await database.items.get(milk!.id)).toBeUndefined()
    expect(await database.items.get(otherGroupMilk.id)).toBeDefined()
    const q = await ops()
    expect(q).toEqual([
      ["item", "delete", milk!.id],
      ["list", "delete", list.id],
    ])
    expect(q.some(([entity]) => entity === "listItem")).toBe(false)
    expect(entries).toHaveLength(1)
  })

  it("購入履歴でないリストは履歴として削除できない", async () => {
    const list = await shoppingList([{ name: "牛乳", checked: true }])

    await expect(deleteHistory(local(), list.id)).rejects.toThrow("履歴が見つかりません")
    expect(await database.lists.get(list.id)).toBeDefined()
    expect(await queue()).toEqual([])
  })
})

describe("ゲスト（キューに積まない・今と同じ結果）", () => {
  async function guestList(entries: Array<{ name: string; checked: boolean }>) {
    const list = await createList(guest(), { name: "買い物" })
    for (const e of entries) {
      const entry = await addNewItemToList(guest(), { listId: list.id, name: e.name })
      if (e.checked) await checkItem(guest(), entry.id, true)
    }
    return list
  }

  it("ゲストはチェック 0 件で完了するとエラーになる", async () => {
    const list = await guestList([{ name: "牛乳", checked: false }])

    await expect(finishShopping(guest(), list.id, undefined)).rejects.toThrow("購入済みのアイテムがありません")
    expect((await database.lists.get(list.id))?.status).toBe("in_progress")
    expect(await database.listItems.where("listId").equals(list.id).count()).toBe(1)
  })

  it("ゲストでは同じ groupId の未購入の商品を消す", async () => {
    // リストの groupId と同じ商品だけを消す（ゲストのリストの商品の groupId は使わない）
    const list = await createList(guest(), { name: "買い物", groupId: GROUP })
    const milk = await catalog("牛乳", { groupId: GROUP })
    const egg = await catalog("卵", { groupId: GROUP })
    const personal = await catalog("牛乳")
    const purchased = await catalog("牛乳", { groupId: GROUP, purchasedAt: BEFORE })
    const other = await catalog("パン", { groupId: GROUP })
    await addItemToList(guest(), { listId: list.id, itemId: milk.id })
    await addItemToList(guest(), { listId: list.id, itemId: egg.id })
    // リストの商品の groupId がリストと違っても、リストの groupId で照合する
    await database.listItems.toCollection().modify({ groupId: undefined })

    await deleteList(guest(), list.id, { deleteCatalogItems: true })

    expect(await database.lists.get(list.id)).toBeUndefined()
    expect(await database.listItems.where("listId").equals(list.id).count()).toBe(0)
    expect(await database.items.get(milk.id)).toBeUndefined()
    expect(await database.items.get(egg.id)).toBeUndefined()
    expect(await database.items.get(personal.id)).toBeDefined()
    expect(await database.items.get(purchased.id)).toBeDefined()
    expect(await database.items.get(other.id)).toBeDefined()
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("ゲストの完了は同じ名前の未購入の商品だけを購入済みにする", async () => {
    const list = await guestList([{ name: "牛乳", checked: true }, { name: "卵", checked: false }])
    const old = await catalog("牛乳", { purchasedAt: BEFORE })

    await finishShopping(guest(), list.id, undefined)

    const fresh = await database.items.filter((i) => i.name === "牛乳" && i.id !== old.id).first()
    expect(fresh?.purchasedAt).toEqual(new Date(NOW))
    expect((await database.items.get(old.id))?.purchasedAt).toEqual(BEFORE)
    expect((await database.listItems.where("listId").equals(list.id).toArray()).map((e) => e.name)).toEqual(["牛乳"])
    expect((await database.lists.get(list.id))?.status).toBe("completed")
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("ゲストの取り消し・履歴の削除は名前で照合し、端末から消し、キューは空のまま", async () => {
    const list = await guestList([{ name: "牛乳", checked: true }])
    await finishShopping(guest(), list.id, undefined)

    await revertHistory(guest(), list.id)
    const milk = await database.items.filter((i) => i.name === "牛乳").first()
    expect(milk?.purchasedAt).toBeUndefined()
    expect((await database.lists.get(list.id))?.status).toBe("in_progress")

    const entries = await database.listItems.where("listId").equals(list.id).toArray()
    await checkItem(guest(), entries[0].id, true)
    await finishShopping(guest(), list.id, undefined)
    await deleteHistory(guest(), list.id)
    expect(await database.lists.count()).toBe(0)
    expect(await database.listItems.count()).toBe(0)
    expect(await database.items.count()).toBe(0)
    expect(await database.syncQueue.count()).toBe(0)
  })

  it("ゲストのリストへの追加・リストの削除もキューに積まない", async () => {
    const milk = await catalog("牛乳")
    const list = await createList(guest(), { name: "買い物" })
    await addItemToList(guest(), { listId: list.id, itemId: milk.id })
    await deleteList(guest(), list.id)

    expect(await database.lists.count()).toBe(0)
    expect(await database.listItems.count()).toBe(0)
    expect(await database.items.get(milk.id)).toBeDefined()
    expect(await database.syncQueue.count()).toBe(0)
  })
})
