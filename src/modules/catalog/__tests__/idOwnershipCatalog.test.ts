import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeTagDb, type TagRow } from "./helpers/fakeTagDb"

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fakeTagDb").createFakeTagDb>,
  item: null as null | { id: string; userId: string | null; groupId: string | null },
  isMember: true,
  createItem: vi.fn(),
  updateItem: vi.fn(),
}))

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: new Proxy({}, { get: (_t, prop) => (state.fake.db as never)[prop] }),
}))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository", () => ({
  itemRepository: { findById: async () => state.item },
}))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository", () => ({ tagRepository: {} }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({
  groupRepository: { isMember: async () => state.isMember },
}))
vi.mock("@/modules/catalog/application/services/CatalogSyncService", () => ({
  CatalogSyncService: class {
    canAccessItem = async () => true
    createItem = state.createItem
    updateItem = state.updateItem
  },
}))

import { catalogRouter } from "@/infrastructure/trpc/routers/catalog"

const ME = "user-me"
const ITEM_ID = "22222222-2222-4222-8222-222222222222"
const TAG_ID = "44444444-4444-4444-8444-444444444444"
const GROUP = "55555555-5555-4555-8555-555555555555"
const OTHER_GROUP = "66666666-6666-4666-8666-666666666666"

const caller = () => catalogRouter.createCaller({ userId: ME })
const setTags = (map: Record<string, TagRow>) => {
  state.fake = createFakeTagDb(map)
}

beforeEach(() => {
  state.fake = createFakeTagDb()
  state.item = null
  state.isMember = true
  state.createItem.mockReset().mockResolvedValue({ id: "new" })
  state.updateItem.mockReset().mockResolvedValue({ id: ITEM_ID })
})

describe("catalog.createItem のタグ検証 (#68)", () => {
  it("他ユーザーのタグを指定するとFORBIDDENで作成されない", async () => {
    setTags({ [TAG_ID]: { id: TAG_ID, userId: "someone", groupId: null } })

    await expect(caller().createItem({ name: "牛乳", quantity: 1, tagIds: [TAG_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.createItem).not.toHaveBeenCalled()
  })

  it("存在しないタグを指定するとFORBIDDEN", async () => {
    await expect(caller().createItem({ name: "牛乳", quantity: 1, tagIds: [TAG_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("グループのアイテムに別グループのタグは指定できない", async () => {
    setTags({ [TAG_ID]: { id: TAG_ID, userId: ME, groupId: OTHER_GROUP } })

    await expect(
      caller().createItem({ name: "牛乳", quantity: 1, tagIds: [TAG_ID], groupId: GROUP })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("個人アイテムにグループのタグは指定できない", async () => {
    setTags({ [TAG_ID]: { id: TAG_ID, userId: ME, groupId: GROUP } })

    await expect(caller().createItem({ name: "牛乳", quantity: 1, tagIds: [TAG_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("自分の個人タグなら個人アイテムを作成できる", async () => {
    setTags({ [TAG_ID]: { id: TAG_ID, userId: ME, groupId: null } })

    await caller().createItem({ name: "牛乳", quantity: 1, tagIds: [TAG_ID] })

    expect(state.createItem).toHaveBeenCalledWith(expect.objectContaining({ tagIds: [TAG_ID], userId: ME }), ME)
  })

  it("同グループの他メンバーのタグならグループアイテムを作成できる", async () => {
    setTags({ [TAG_ID]: { id: TAG_ID, userId: "other-member", groupId: GROUP } })

    await caller().createItem({ name: "牛乳", quantity: 1, tagIds: [TAG_ID], groupId: GROUP })

    expect(state.createItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP }), ME)
  })

  it("タグなしなら作成できる（タグの検索はしない）", async () => {
    await caller().createItem({ name: "牛乳", quantity: 1, tagIds: [] })

    expect(state.createItem).toHaveBeenCalled()
    expect(state.fake.selects).toHaveLength(0)
  })
})

describe("catalog.updateItem のタグ検証 (#68)", () => {
  it("既存アイテムと別スコープ（他ユーザー）のタグへの変更はFORBIDDEN", async () => {
    state.item = { id: ITEM_ID, userId: ME, groupId: null }
    setTags({ [TAG_ID]: { id: TAG_ID, userId: "someone", groupId: null } })

    await expect(caller().updateItem({ id: ITEM_ID, tagIds: [TAG_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(state.updateItem).not.toHaveBeenCalled()
  })

  it("グループアイテムに個人タグは指定できない", async () => {
    state.item = { id: ITEM_ID, userId: ME, groupId: GROUP }
    setTags({ [TAG_ID]: { id: TAG_ID, userId: ME, groupId: null } })

    await expect(caller().updateItem({ id: ITEM_ID, tagIds: [TAG_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("アイテムが見つからない場合はタグ指定の更新を拒否する", async () => {
    setTags({ [TAG_ID]: { id: TAG_ID, userId: ME, groupId: null } })

    await expect(caller().updateItem({ id: ITEM_ID, tagIds: [TAG_ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("同じスコープのタグなら更新できる", async () => {
    state.item = { id: ITEM_ID, userId: "creator", groupId: GROUP }
    setTags({ [TAG_ID]: { id: TAG_ID, userId: "other-member", groupId: GROUP } })

    await caller().updateItem({ id: ITEM_ID, tagIds: [TAG_ID] })

    expect(state.updateItem).toHaveBeenCalledWith(expect.objectContaining({ tagIds: [TAG_ID] }), ME)
  })

  it("tagIds を指定しない更新ではタグを検証せず更新できる", async () => {
    await caller().updateItem({ id: ITEM_ID, name: "新しい名前" })

    expect(state.updateItem).toHaveBeenCalled()
    expect(state.fake.selects).toHaveLength(0)
  })

  it("tagIds を空配列にする更新（タグ全解除）は許可される", async () => {
    state.item = { id: ITEM_ID, userId: ME, groupId: null }

    await caller().updateItem({ id: ITEM_ID, tagIds: [] })

    expect(state.updateItem).toHaveBeenCalled()
  })
})
