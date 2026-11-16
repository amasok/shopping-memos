import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeTagDb, type TagRow } from "./helpers/fakeTagDb"

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fakeTagDb").createFakeTagDb>,
  list: null as null | { id: string; status: string; groupId: string | null },
  items: {} as Record<string, unknown>,
  isMember: true,
  findMany: vi.fn(),
  syncAddItem: vi.fn(),
  syncCreateList: vi.fn(),
  catalogCreateItem: vi.fn(),
}))

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: new Proxy({}, { get: (_t, prop) => (state.fake.db as never)[prop] }),
}))
vi.mock("@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository", () => ({
  shoppingListRepository: {},
}))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository", () => ({
  itemRepository: {
    findById: async (id: string) => state.items[id] ?? null,
    findMany: (...a: unknown[]) => state.findMany(...a),
  },
}))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository", () => ({ tagRepository: {} }))
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({ syncRepository: {} }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({
  groupRepository: { isMember: async () => state.isMember, findByUserId: async () => [] },
}))
vi.mock("@/modules/catalog/application/services/CatalogSyncService", () => ({
  CatalogSyncService: class {
    createItem = state.catalogCreateItem
  },
}))
vi.mock("@/modules/shopping/application/services/ShoppingSyncService", () => ({
  ShoppingSyncService: class {
    canAccessList = async () => true
    getList = async () => state.list
    addItem = state.syncAddItem
    createList = state.syncCreateList
  },
}))

import { shoppingRouter } from "@/infrastructure/trpc/routers/shopping"

const ME = "user-me"
const LIST_ID = "11111111-1111-4111-8111-111111111111"
const ITEM_ID = "22222222-2222-4222-8222-222222222222"
const ITEM2_ID = "33333333-3333-4333-8333-333333333333"
const TAG_ID = "44444444-4444-4444-8444-444444444444"
const GROUP = "55555555-5555-4555-8555-555555555555"
const OTHER_GROUP = "66666666-6666-4666-8666-666666666666"

const caller = () => shoppingRouter.createCaller({ userId: ME })
const item = (id: string, userId: string, groupId: string | null, name = "牛乳") => ({
  id,
  name,
  quantity: 1,
  memo: null,
  userId,
  groupId,
  tags: [{ id: "t1", name: "食品" }],
})
const setList = (groupId: string | null) => {
  state.list = { id: LIST_ID, status: "in_progress", groupId }
}
const setTags = (map: Record<string, TagRow>) => {
  state.fake = createFakeTagDb(map)
}

beforeEach(() => {
  state.fake = createFakeTagDb()
  state.list = null
  state.items = {}
  state.isMember = true
  state.findMany.mockReset().mockResolvedValue([])
  state.syncAddItem.mockReset().mockResolvedValue({ id: "li" })
  state.syncCreateList.mockReset().mockResolvedValue(undefined)
  state.catalogCreateItem.mockReset().mockResolvedValue(undefined)
})

describe("shopping.addItemToList のスコープ検証 (#68)", () => {
  it("他ユーザーの個人アイテムは自分の個人リストに追加できない", async () => {
    setList(null)
    state.items[ITEM_ID] = item(ITEM_ID, "someone", null)

    await expect(caller().addItemToList({ listId: LIST_ID, itemId: ITEM_ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.syncAddItem).not.toHaveBeenCalled()
  })

  it("別グループのアイテムはグループリストに追加できない", async () => {
    setList(GROUP)
    state.items[ITEM_ID] = item(ITEM_ID, ME, OTHER_GROUP)

    await expect(caller().addItemToList({ listId: LIST_ID, itemId: ITEM_ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.syncAddItem).not.toHaveBeenCalled()
  })

  it("自分の個人アイテムでも、グループリストには追加できない", async () => {
    setList(GROUP)
    state.items[ITEM_ID] = item(ITEM_ID, ME, null)

    await expect(caller().addItemToList({ listId: LIST_ID, itemId: ITEM_ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("グループアイテムは個人リストに追加できない", async () => {
    setList(null)
    state.items[ITEM_ID] = item(ITEM_ID, ME, GROUP)

    await expect(caller().addItemToList({ listId: LIST_ID, itemId: ITEM_ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("自分の個人アイテムは自分の個人リストに追加でき、groupId は null", async () => {
    setList(null)
    state.items[ITEM_ID] = item(ITEM_ID, ME, null)

    await caller().addItemToList({ listId: LIST_ID, itemId: ITEM_ID })

    expect(state.syncAddItem).toHaveBeenCalledWith(expect.objectContaining({ listId: LIST_ID, name: "牛乳", groupId: null }), ME)
  })

  it("グループリストには他メンバーが作成した同グループのアイテムを追加でき、groupId はリストの値", async () => {
    setList(GROUP)
    state.items[ITEM_ID] = item(ITEM_ID, "other-member", GROUP)

    await caller().addItemToList({ listId: LIST_ID, itemId: ITEM_ID })

    expect(state.syncAddItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP }), ME)
  })

  it("存在しないアイテムは NOT_FOUND", async () => {
    setList(null)

    await expect(caller().addItemToList({ listId: LIST_ID, itemId: ITEM_ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("shopping.createList のスコープ検証 (#68)", () => {
  it("他ユーザーのアイテムIDを指定するとFORBIDDENで、リストは作成されない", async () => {
    state.items[ITEM_ID] = item(ITEM_ID, "someone", null)

    await expect(caller().createList({ name: "x", itemIds: [ITEM_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.syncCreateList).not.toHaveBeenCalled()
    expect(state.syncAddItem).not.toHaveBeenCalled()
  })

  it("自分のアイテムの後に他人のアイテムがあっても、1件も追加せずリストも作らない", async () => {
    state.items[ITEM_ID] = item(ITEM_ID, ME, null)
    state.items[ITEM2_ID] = item(ITEM2_ID, "someone", null, "パン")

    await expect(caller().createList({ name: "x", itemIds: [ITEM_ID, ITEM2_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.syncCreateList).not.toHaveBeenCalled()
    expect(state.syncAddItem).not.toHaveBeenCalled()
  })

  it("個人リストに別グループのアイテムは指定できない", async () => {
    state.items[ITEM_ID] = item(ITEM_ID, ME, GROUP)

    await expect(caller().createList({ name: "x", itemIds: [ITEM_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("自分のアイテムなら追加され、groupId はリストの値(null)", async () => {
    state.items[ITEM_ID] = item(ITEM_ID, ME, null)

    await caller().createList({ name: "x", itemIds: [ITEM_ID] })

    expect(state.syncCreateList).toHaveBeenCalledTimes(1)
    expect(state.syncAddItem).toHaveBeenCalledWith(expect.objectContaining({ name: "牛乳", groupId: null }), ME)
  })

  it("グループリストには同グループの他メンバーのアイテムを指定でき、groupId はグループ", async () => {
    state.items[ITEM_ID] = item(ITEM_ID, "other-member", GROUP)

    await caller().createList({ name: "x", itemIds: [ITEM_ID], groupId: GROUP })

    expect(state.syncAddItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP }), ME)
  })

  it("存在しないアイテムIDは無視する（従来どおり）", async () => {
    await caller().createList({ name: "x", itemIds: [ITEM_ID] })

    expect(state.syncCreateList).toHaveBeenCalledTimes(1)
    expect(state.syncAddItem).not.toHaveBeenCalled()
  })

  it("グループのメンバーでなければFORBIDDENで何もしない", async () => {
    state.isMember = false

    await expect(caller().createList({ name: "x", groupId: GROUP })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.syncCreateList).not.toHaveBeenCalled()
  })

  it("tagIds 指定の検索は呼び出しユーザーの個人アイテムに限定される", async () => {
    state.findMany.mockResolvedValue([item(ITEM_ID, ME, null)])

    await caller().createList({ name: "x", tagIds: [TAG_ID] })

    expect(state.findMany).toHaveBeenCalledWith(expect.objectContaining({ userId: ME, groupId: undefined, tagIds: [TAG_ID] }))
    expect(state.syncAddItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: null }), ME)
  })

  it("tagIds 指定でグループリストなら、グループで検索し groupId はグループ", async () => {
    state.findMany.mockResolvedValue([item(ITEM_ID, "other-member", GROUP)])

    await caller().createList({ name: "x", tagIds: [TAG_ID], groupId: GROUP })

    expect(state.findMany).toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP, userId: ME }))
    expect(state.syncAddItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP }), ME)
  })
})

describe("shopping.addNewItemToList のタグ検証 (#68)", () => {
  const input = (tagIds?: string[]) => ({ listId: LIST_ID, name: "新規", quantity: 1, tagIds })

  it("他ユーザーのタグを指定するとFORBIDDENで、カタログにもリストにも追加されない", async () => {
    setList(null)
    setTags({ [TAG_ID]: { id: TAG_ID, userId: "someone", groupId: null } })

    await expect(caller().addNewItemToList(input([TAG_ID]))).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.catalogCreateItem).not.toHaveBeenCalled()
    expect(state.syncAddItem).not.toHaveBeenCalled()
  })

  it("存在しないタグを指定するとFORBIDDEN", async () => {
    setList(null)

    await expect(caller().addNewItemToList(input([TAG_ID]))).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("グループリストに個人タグは指定できない", async () => {
    setList(GROUP)
    setTags({ [TAG_ID]: { id: TAG_ID, userId: ME, groupId: null } })

    await expect(caller().addNewItemToList(input([TAG_ID]))).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("自分の個人タグは個人リストで使える", async () => {
    setList(null)
    setTags({ [TAG_ID]: { id: TAG_ID, userId: ME, groupId: null } })

    await caller().addNewItemToList(input([TAG_ID]))

    expect(state.catalogCreateItem).toHaveBeenCalledTimes(1)
    expect(state.syncAddItem).toHaveBeenCalledWith(expect.objectContaining({ tagIds: [TAG_ID], groupId: null }), ME)
  })

  it("グループリストには他メンバーが作った同グループのタグを指定できる", async () => {
    setList(GROUP)
    setTags({ [TAG_ID]: { id: TAG_ID, userId: "other-member", groupId: GROUP } })

    await caller().addNewItemToList(input([TAG_ID]))

    expect(state.catalogCreateItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP, userId: ME }), ME)
  })

  it("タグ未指定ならタグの検索をしない", async () => {
    setList(null)

    await caller().addNewItemToList(input())

    expect(state.fake.selects).toHaveLength(0)
    expect(state.syncAddItem).toHaveBeenCalled()
  })
})
