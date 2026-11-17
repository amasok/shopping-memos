// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const svc = vi.hoisted(() => ({
  getItems: vi.fn(), getItem: vi.fn(), canAccessItem: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(),
  deleteItem: vi.fn(), markItemAsPurchased: vi.fn(), markItemAsUnpurchased: vi.fn(),
  getTags: vi.fn(), getTag: vi.fn(), canAccessTag: vi.fn(), createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn(),
}))
const isMember = vi.hoisted(() => vi.fn())
const areTagsInScope = vi.hoisted(() => vi.fn())
const findById = vi.hoisted(() => vi.fn())
const activeRows = vi.hoisted(() => ({ rows: [] as { name: string }[] }))

vi.mock("@/infrastructure/auth/server", () => ({ getAuth: vi.fn() }))
vi.mock("@/modules/catalog/application/services/CatalogSyncService", () => ({
  CatalogSyncService: class {
    constructor() {
      return svc
    }
  },
}))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository", () => ({ itemRepository: { findById } }))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository", () => ({ tagRepository: {} }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({
  groupRepository: { isMember },
}))
vi.mock("@/modules/catalog/application/services/ownership", () => ({ areTagsInScope }))
vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(activeRows.rows) }) }),
    }),
  },
}))

import { catalogRouter } from "../catalog"

const UID = "11111111-1111-4111-8111-111111111111"
const GID = "22222222-2222-4222-8222-222222222222"
const IID = "33333333-3333-4333-8333-333333333333"

const caller = (userId: string | null = "user-1") => catalogRouter.createCaller({ userId: userId ?? undefined } as never)

beforeEach(() => {
  vi.resetAllMocks()
  activeRows.rows = []
  isMember.mockResolvedValue(true)
  areTagsInScope.mockResolvedValue(true)
  svc.canAccessItem.mockResolvedValue(true)
  svc.canAccessTag.mockResolvedValue(true)
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("catalog ルーター: 認証", () => {
  it("ログインしていないと UNAUTHORIZED", async () => {
    await expect(caller(null).getItems({})).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })
})

describe("catalog.getItems", () => {
  it("進行中のリストに入っているアイテムは除外して返す", async () => {
    svc.getItems.mockResolvedValue([{ id: "1", name: "牛乳" }, { id: "2", name: "卵" }])
    activeRows.rows = [{ name: "牛乳" }]
    expect(await caller().getItems({})).toEqual([{ id: "2", name: "卵" }])
    expect(svc.getItems).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", groupId: undefined }))
  })

  it("グループ指定のとき、メンバーでなければ FORBIDDEN でアイテムを取らない", async () => {
    isMember.mockResolvedValue(false)
    await expect(caller().getItems({ groupId: GID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(svc.getItems).not.toHaveBeenCalled()
  })

  it("グループ指定でメンバーなら groupId を渡して取得する", async () => {
    svc.getItems.mockResolvedValue([])
    await caller().getItems({ groupId: GID })
    expect(svc.getItems).toHaveBeenCalledWith(expect.objectContaining({ groupId: GID }))
  })
})

describe("catalog.getItem", () => {
  it("権限がなければ FORBIDDEN", async () => {
    svc.canAccessItem.mockResolvedValue(false)
    await expect(caller().getItem({ id: IID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("存在しなければ NOT_FOUND", async () => {
    svc.getItem.mockResolvedValue(null)
    await expect(caller().getItem({ id: IID })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("アイテムを返す", async () => {
    svc.getItem.mockResolvedValue({ id: IID, name: "牛乳" })
    expect(await caller().getItem({ id: IID })).toEqual({ id: IID, name: "牛乳" })
  })
})

describe("catalog.createItem", () => {
  it("グループのメンバーでなければ FORBIDDEN", async () => {
    isMember.mockResolvedValue(false)
    await expect(caller().createItem({ name: "牛乳", groupId: GID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(svc.createItem).not.toHaveBeenCalled()
  })

  it("スコープ外のタグを指定すると FORBIDDEN で作成しない", async () => {
    areTagsInScope.mockResolvedValue(false)
    await expect(caller().createItem({ name: "牛乳", tagIds: [UID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(svc.createItem).not.toHaveBeenCalled()
  })

  it("タグの検証には、ログインユーザーと入力の groupId のスコープを渡す", async () => {
    svc.createItem.mockResolvedValue({ id: "new" })
    await caller().createItem({ name: "牛乳", tagIds: [UID], groupId: GID })
    expect(areTagsInScope).toHaveBeenCalledWith([UID], { userId: "user-1", groupId: GID })
  })

  it("ユーザー ID と新しい ID を付けて作成し、同期ログ用に userId も渡す", async () => {
    svc.createItem.mockResolvedValue({ id: "new" })
    await caller().createItem({ name: "牛乳", quantity: 2, memo: "低脂肪" })
    expect(svc.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String), name: "牛乳", quantity: 2, memo: "低脂肪", userId: "user-1", tagIds: [] }),
      "user-1"
    )
  })

  it("名前が空だとバリデーションエラー", async () => {
    await expect(caller().createItem({ name: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("catalog.updateItem", () => {
  it("権限がなければ FORBIDDEN", async () => {
    svc.canAccessItem.mockResolvedValue(false)
    await expect(caller().updateItem({ id: IID, name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("tagIds 指定でアイテムが見つからなければ FORBIDDEN", async () => {
    findById.mockResolvedValue(null)
    await expect(caller().updateItem({ id: IID, tagIds: [UID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(svc.updateItem).not.toHaveBeenCalled()
  })

  it("tagIds がアイテムのスコープ外なら FORBIDDEN", async () => {
    findById.mockResolvedValue({ id: IID, userId: "user-1" })
    areTagsInScope.mockResolvedValue(false)
    await expect(caller().updateItem({ id: IID, tagIds: [UID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("tagIds を指定しなければタグの検証をせずに更新する", async () => {
    svc.updateItem.mockResolvedValue({ id: IID })
    await caller().updateItem({ id: IID, name: "新" })
    expect(findById).not.toHaveBeenCalled()
    expect(svc.updateItem).toHaveBeenCalledWith(expect.objectContaining({ id: IID, name: "新" }), "user-1")
  })

  it("tagIds が範囲内なら更新する", async () => {
    findById.mockResolvedValue({ id: IID, userId: "user-1" })
    svc.updateItem.mockResolvedValue({ id: IID })
    await caller().updateItem({ id: IID, tagIds: [UID] })
    expect(areTagsInScope).toHaveBeenCalledWith([UID], { id: IID, userId: "user-1" })
    expect(svc.updateItem).toHaveBeenCalledWith(expect.objectContaining({ tagIds: [UID] }), "user-1")
  })
})

describe.each([
  ["deleteItem", svc.deleteItem],
  ["markItemAsPurchased", svc.markItemAsPurchased],
  ["markItemAsUnpurchased", svc.markItemAsUnpurchased],
] as const)("catalog.%s", (name, fn) => {
  it("権限がなければ FORBIDDEN で何もしない", async () => {
    svc.canAccessItem.mockResolvedValue(false)
    await expect(caller()[name]({ id: IID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(fn).not.toHaveBeenCalled()
  })

  it("権限があれば実行する", async () => {
    fn.mockResolvedValue({ id: IID })
    await caller()[name]({ id: IID })
    expect(fn).toHaveBeenCalledWith(IID, "user-1")
  })

})

describe("catalog.deleteItem の戻り値", () => {
  it("success を返す", async () => {
    expect(await caller().deleteItem({ id: IID })).toEqual({ success: true })
  })
})

describe("catalog のタグ", () => {
  it("getTags: メンバーでないグループは FORBIDDEN", async () => {
    isMember.mockResolvedValue(false)
    await expect(caller().getTags({ groupId: GID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("getTags: 個人のタグを取得する", async () => {
    svc.getTags.mockResolvedValue([{ id: "t" }])
    expect(await caller().getTags({})).toEqual([{ id: "t" }])
    expect(svc.getTags).toHaveBeenCalledWith({ userId: "user-1", groupId: undefined })
  })

  it("getTag: 権限がなければ FORBIDDEN", async () => {
    svc.canAccessTag.mockResolvedValue(false)
    await expect(caller().getTag({ id: IID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("getTag: 存在しなければ NOT_FOUND", async () => {
    svc.getTag.mockResolvedValue(null)
    await expect(caller().getTag({ id: IID })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("getTag: あれば返す", async () => {
    svc.getTag.mockResolvedValue({ id: IID })
    expect(await caller().getTag({ id: IID })).toEqual({ id: IID })
  })

  it("createTag: メンバーでないグループは FORBIDDEN", async () => {
    isMember.mockResolvedValue(false)
    await expect(caller().createTag({ name: "x", groupId: GID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(svc.createTag).not.toHaveBeenCalled()
  })

  it("createTag: 作成する", async () => {
    svc.createTag.mockResolvedValue({ id: "t" })
    await caller().createTag({ name: "食品" })
    expect(svc.createTag).toHaveBeenCalledWith(expect.objectContaining({ name: "食品", userId: "user-1" }), "user-1")
  })

  it("updateTag: 権限なしは FORBIDDEN", async () => {
    svc.canAccessTag.mockResolvedValue(false)
    await expect(caller().updateTag({ id: IID, name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(svc.updateTag).not.toHaveBeenCalled()
  })

  it("updateTag: 更新する", async () => {
    svc.updateTag.mockResolvedValue({ id: IID })
    await caller().updateTag({ id: IID, name: "新" })
    expect(svc.updateTag).toHaveBeenCalledWith({ id: IID, name: "新" }, "user-1")
  })

  it("deleteTag: 権限なしは FORBIDDEN", async () => {
    svc.canAccessTag.mockResolvedValue(false)
    await expect(caller().deleteTag({ id: IID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(svc.deleteTag).not.toHaveBeenCalled()
  })

  it("deleteTag: 削除して success を返す", async () => {
    expect(await caller().deleteTag({ id: IID })).toEqual({ success: true })
    expect(svc.deleteTag).toHaveBeenCalledWith(IID, "user-1")
  })
})

describe("catalog の作成時のクライアント ID（#62 O3b）", () => {
  it("createItem / createTag は、id があればその id で作り、なければサーバーで採番する", async () => {
    await caller().createItem({ name: "牛乳", id: IID })
    expect(svc.createItem).toHaveBeenCalledWith(expect.objectContaining({ id: IID }), "user-1")
    await caller().createTag({ name: "食品", id: IID })
    expect(svc.createTag).toHaveBeenCalledWith(expect.objectContaining({ id: IID }), "user-1")

    await caller().createItem({ name: "卵" })
    const generated = svc.createItem.mock.calls[1][0].id
    expect(generated).toMatch(/^[0-9a-f-]{36}$/)
    expect(generated).not.toBe(IID)
  })
})
