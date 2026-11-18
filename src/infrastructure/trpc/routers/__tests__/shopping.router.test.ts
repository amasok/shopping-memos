// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const sync = vi.hoisted(() => ({
  getLists: vi.fn(), getList: vi.fn(), canAccessList: vi.fn(), createList: vi.fn(), updateList: vi.fn(),
  deleteList: vi.fn(), addItem: vi.fn(), canAccessItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn(),
  updateItem: vi.fn(), getHistory: vi.fn(), canAccessHistory: vi.fn(), getHistoryById: vi.fn(),
  deleteHistory: vi.fn(),
}))
const shopping = vi.hoisted(() => ({ finishShopping: vi.fn(), revertHistory: vi.fn() }))
const catalog = vi.hoisted(() => ({ createItem: vi.fn() }))
const itemRepo = vi.hoisted(() => ({ findById: vi.fn(), findMany: vi.fn() }))
const groupRepo = vi.hoisted(() => ({ isMember: vi.fn(), findByUserId: vi.fn() }))
const syncRepo = vi.hoisted(() => ({ createOperation: vi.fn() }))
const scope = vi.hoisted(() => ({
  getListScope: vi.fn(), deleteScopedItemsByName: vi.fn(),
}))
const areTagsInScope = vi.hoisted(() => vi.fn())
// リストのアイテムの ID が使用済みかの確認（addNewItemToList）で返す行
const existingListItems = vi.hoisted(() => ({ rows: [] as { id: string }[] }))

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(existingListItems.rows) }) }) },
}))
vi.mock("@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository", () => ({ shoppingListRepository: {} }))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleItemRepository", () => ({ itemRepository: itemRepo }))
vi.mock("@/modules/catalog/infrastructure/repositories/DrizzleTagRepository", () => ({ tagRepository: {} }))
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({ syncRepository: syncRepo }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({ groupRepository: groupRepo }))
vi.mock("@/modules/catalog/application/services/CatalogSyncService", () => ({
  CatalogSyncService: class {
    constructor() {
      return catalog
    }
  },
}))
vi.mock("@/modules/shopping/application/services/ShoppingSyncService", () => ({
  ShoppingSyncService: class {
    constructor() {
      return sync
    }
  },
}))
vi.mock("@/modules/shopping/application/services/ShoppingService", async (orig) => {
  const actual = await orig<typeof import("@/modules/shopping/application/services/ShoppingService")>()
  return {
    ...actual,
    ShoppingService: class {
      constructor() {
        return shopping
      }
    },
  }
})
vi.mock("@/modules/catalog/application/services/ownership", () => ({ areTagsInScope }))
vi.mock("@/modules/shopping/application/services/catalogItemScope", () => scope)

import { shoppingRouter } from "../shopping"
import { ShoppingDomainError } from "@/modules/shopping/application/services/ShoppingService"

const ID = "33333333-3333-4333-8333-333333333333"
const ID2 = "44444444-4444-4444-8444-444444444444"
const GID = "22222222-2222-4222-8222-222222222222"
const TAG = "55555555-5555-4555-8555-555555555555"
const caller = () => shoppingRouter.createCaller({ userId: "user-1" } as never)

const catalogItem = (over = {}) => ({
  id: ID, name: "牛乳", quantity: 2, memo: "m", userId: "user-1", groupId: null, tags: [{ id: TAG }], ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  existingListItems.rows = []
  sync.canAccessList.mockResolvedValue(true)
  sync.canAccessItem.mockResolvedValue(true)
  sync.canAccessHistory.mockResolvedValue(true)
  groupRepo.isMember.mockResolvedValue(true)
  areTagsInScope.mockResolvedValue(true)
})

describe("shopping.getLists", () => {
  it("メンバーでないグループは FORBIDDEN", async () => {
    groupRepo.isMember.mockResolvedValue(false)
    await expect(caller().getLists({ groupId: GID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("includeAllGroups のとき所属グループの ID を渡す", async () => {
    groupRepo.findByUserId.mockResolvedValue([{ id: "a" }, { id: "b" }])
    sync.getLists.mockResolvedValue([])
    await caller().getLists({ includeAllGroups: true })
    expect(sync.getLists).toHaveBeenCalledWith(expect.objectContaining({ accessibleGroupIds: ["a", "b"], userId: "user-1" }))
  })

  it("includeAllGroups でなければグループを引かない", async () => {
    sync.getLists.mockResolvedValue([])
    await caller().getLists({ status: "in_progress" })
    expect(groupRepo.findByUserId).not.toHaveBeenCalled()
    expect(sync.getLists).toHaveBeenCalledWith(expect.objectContaining({ accessibleGroupIds: undefined, status: "in_progress" }))
  })
})

describe("shopping.getList / getListItems", () => {
  it("getList: 権限なしは FORBIDDEN", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().getList({ id: ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("getList: なければ NOT_FOUND", async () => {
    sync.getList.mockResolvedValue(null)
    await expect(caller().getList({ id: ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("getList: あれば返す", async () => {
    sync.getList.mockResolvedValue({ id: ID })
    expect(await caller().getList({ id: ID })).toEqual({ id: ID })
  })

  it("getListItems: 権限なしは FORBIDDEN", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().getListItems({ listId: ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("getListItems: リストがなければ NOT_FOUND", async () => {
    sync.getList.mockResolvedValue(null)
    await expect(caller().getListItems({ listId: ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("getListItems: あればアイテムだけ返す", async () => {
    sync.getList.mockResolvedValue({ id: ID, items: [{ id: "x" }] })
    expect(await caller().getListItems({ listId: ID })).toEqual([{ id: "x" }])
  })
})

describe("shopping.createList", () => {
  beforeEach(() => {
    sync.getList.mockResolvedValue({ id: "new", items: [] })
  })

  it("メンバーでないグループは FORBIDDEN でリストを作らない", async () => {
    groupRepo.isMember.mockResolvedValue(false)
    await expect(caller().createList({ name: "x", groupId: GID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sync.createList).not.toHaveBeenCalled()
  })

  it("itemIds のアイテムがリストとスコープ違いなら、リストを作る前に FORBIDDEN", async () => {
    itemRepo.findById.mockResolvedValue(catalogItem({ userId: "other" }))
    await expect(caller().createList({ name: "x", itemIds: [ID] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sync.createList).not.toHaveBeenCalled()
  })

  it("itemIds: 見つからないアイテムは飛ばし、見つかったものをスナップショットで追加する", async () => {
    itemRepo.findById.mockResolvedValueOnce(null).mockResolvedValueOnce(catalogItem({ id: ID2 }))
    await caller().createList({ name: "週末", itemIds: [ID, ID2] })
    expect(sync.createList).toHaveBeenCalledWith(expect.objectContaining({ name: "週末" }), "user-1")
    expect(sync.addItem).toHaveBeenCalledTimes(1)
    expect(sync.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "牛乳", quantity: 2, memo: "m", tagIds: [TAG], groupId: null }),
      "user-1"
    )
  })

  it("tagIds: 同じスコープの未購入アイテムを検索して追加する", async () => {
    itemRepo.findMany.mockResolvedValue([catalogItem(), catalogItem({ name: "卵" })])
    await caller().createList({ name: "x", tagIds: [TAG], groupId: GID })
    expect(itemRepo.findMany).toHaveBeenCalledWith({ tagIds: [TAG], groupId: GID, userId: "user-1", includePurchased: false })
    expect(sync.addItem).toHaveBeenCalledTimes(2)
    expect(sync.addItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: GID }), "user-1")
  })

  it("クライアントで採番した id があれば、その id でリストを作る（#62 O3b）", async () => {
    sync.getList.mockResolvedValue({ id: ID2, items: [] })
    await caller().createList({ name: "x", id: ID2 })
    expect(sync.createList).toHaveBeenCalledWith(expect.objectContaining({ id: ID2 }), "user-1")
    expect(sync.getList).toHaveBeenCalledWith(ID2)
  })

  it("アイテムの指定がなければ空のリストを作って返す", async () => {
    expect(await caller().createList({ name: "x" })).toEqual({ id: "new", items: [] })
    expect(sync.addItem).not.toHaveBeenCalled()
  })
})

describe("shopping.updateList / deleteList", () => {
  it("updateList: 権限なしは FORBIDDEN", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().updateList({ id: ID, name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sync.updateList).not.toHaveBeenCalled()
  })

  it("updateList: 更新する", async () => {
    sync.updateList.mockResolvedValue({ id: ID })
    await caller().updateList({ id: ID, name: "新" })
    expect(sync.updateList).toHaveBeenCalledWith({ id: ID, name: "新" }, "user-1")
  })

  it("deleteList: 権限なしは FORBIDDEN", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().deleteList({ id: ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sync.deleteList).not.toHaveBeenCalled()
  })

  it("deleteList: 指定しないとリストだけを消す（商品も消す指定は false で渡す）", async () => {
    expect(await caller().deleteList({ id: ID })).toEqual({ success: true })
    expect(sync.deleteList).toHaveBeenCalledWith(ID, "user-1", { deleteCatalogItems: false })
  })

  it("deleteList: 商品も消す指定をサービスに渡す（179b）", async () => {
    expect(await caller().deleteList({ id: ID, deleteCatalogItems: true })).toEqual({ success: true })
    expect(sync.deleteList).toHaveBeenCalledWith(ID, "user-1", { deleteCatalogItems: true })
  })

  it("deleteList: 使えないリストは商品ごと消せない（FORBIDDEN）", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().deleteList({ id: ID, deleteCatalogItems: true })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sync.deleteList).not.toHaveBeenCalled()
  })
})

describe("shopping.addItemToList", () => {
  const input = { listId: ID, itemId: ID2 }
  const list = { id: ID, status: "in_progress", groupId: null }

  it("権限なしは FORBIDDEN", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().addItemToList(input)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("リストがなければ NOT_FOUND", async () => {
    sync.getList.mockResolvedValue(null)
    await expect(caller().addItemToList(input)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("完了したリストには追加できない", async () => {
    sync.getList.mockResolvedValue({ ...list, status: "completed" })
    await expect(caller().addItemToList(input)).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("アイテムがなければ NOT_FOUND", async () => {
    sync.getList.mockResolvedValue(list)
    itemRepo.findById.mockResolvedValue(null)
    await expect(caller().addItemToList(input)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("スコープ違いのアイテムは FORBIDDEN", async () => {
    sync.getList.mockResolvedValue(list)
    itemRepo.findById.mockResolvedValue(catalogItem({ userId: "other" }))
    await expect(caller().addItemToList(input)).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sync.addItem).not.toHaveBeenCalled()
  })

  it("同じスコープならスナップショットとして追加する", async () => {
    sync.getList.mockResolvedValue(list)
    itemRepo.findById.mockResolvedValue(catalogItem())
    sync.addItem.mockResolvedValue({ id: "li" })
    expect(await caller().addItemToList(input)).toEqual({ id: "li" })
    expect(sync.addItem).toHaveBeenCalledWith(expect.objectContaining({ listId: ID, name: "牛乳", tagIds: [TAG] }), "user-1")
  })
})

describe("shopping.addNewItemToList", () => {
  const input = { listId: ID, name: "パン" }
  const list = { id: ID, status: "in_progress", groupId: null }

  it("権限なしは FORBIDDEN", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().addNewItemToList(input)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("リストがなければ NOT_FOUND", async () => {
    sync.getList.mockResolvedValue(null)
    await expect(caller().addNewItemToList(input)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("完了済みのリストには BAD_REQUEST", async () => {
    sync.getList.mockResolvedValue({ ...list, status: "completed" })
    await expect(caller().addNewItemToList(input)).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("スコープ外のタグは FORBIDDEN で何も作らない", async () => {
    sync.getList.mockResolvedValue(list)
    areTagsInScope.mockResolvedValue(false)
    await expect(caller().addNewItemToList({ ...input, tagIds: [TAG] })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(catalog.createItem).not.toHaveBeenCalled()
    expect(sync.addItem).not.toHaveBeenCalled()
  })

  it("グループのリストなら、タグの検証にそのグループのスコープを渡す", async () => {
    sync.getList.mockResolvedValue({ ...list, groupId: GID })
    sync.addItem.mockResolvedValue({ id: "li" })
    await caller().addNewItemToList({ ...input, tagIds: [TAG] })
    expect(areTagsInScope).toHaveBeenCalledWith([TAG], { userId: "user-1", groupId: GID })
    expect(catalog.createItem).toHaveBeenCalledWith(expect.objectContaining({ groupId: GID }), "user-1")
  })

  it("使用済みのリストのアイテムの id は CONFLICT で、カタログのアイテムも作らない（#62 O3b）", async () => {
    sync.getList.mockResolvedValue(list)
    existingListItems.rows = [{ id: ID2 }]
    await expect(caller().addNewItemToList({ ...input, id: ID2 })).rejects.toMatchObject({ code: "CONFLICT" })
    expect(catalog.createItem).not.toHaveBeenCalled()
    expect(sync.addItem).not.toHaveBeenCalled()
  })

  it("未使用のリストのアイテムの id なら、その id でリストのアイテムを作る（#62 O3b）", async () => {
    sync.getList.mockResolvedValue(list)
    sync.addItem.mockResolvedValue({ id: ID2 })
    await caller().addNewItemToList({ ...input, id: ID2 })
    expect(sync.addItem).toHaveBeenCalledWith(expect.objectContaining({ id: ID2 }), "user-1")
  })

  it("カタログとリストの両方にアイテムを作る（数量の既定は 1）", async () => {
    sync.getList.mockResolvedValue(list)
    sync.addItem.mockResolvedValue({ id: "li" })
    await caller().addNewItemToList(input)
    expect(areTagsInScope).toHaveBeenCalledWith(undefined, { userId: "user-1", groupId: null })
    expect(catalog.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "パン", quantity: 1, userId: "user-1", groupId: undefined, tagIds: [] }),
      "user-1"
    )
    expect(sync.addItem).toHaveBeenCalledWith(expect.objectContaining({ listId: ID, name: "パン", quantity: 1, tagIds: [] }), "user-1")
  })
})

describe.each([
  ["removeItemFromList", (c: ReturnType<typeof caller>) => c.removeItemFromList({ id: ID })],
  ["checkItem", (c: ReturnType<typeof caller>) => c.checkItem({ listItemId: ID, checked: true })],
] as const)("shopping.%s", (_name, run) => {
  it("権限なしは FORBIDDEN", async () => {
    sync.canAccessItem.mockResolvedValue(false)
    await expect(run(caller())).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("アイテムがなければ NOT_FOUND", async () => {
    sync.getItem.mockResolvedValue(null)
    await expect(run(caller())).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("完了したリストのアイテムは変更できない", async () => {
    sync.getItem.mockResolvedValue({ id: ID, listId: "l" })
    sync.getList.mockResolvedValue({ status: "completed" })
    await expect(run(caller())).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(sync.removeItem).not.toHaveBeenCalled()
    expect(sync.updateItem).not.toHaveBeenCalled()
  })
})

describe("shopping.removeItemFromList / checkItem の成功", () => {
  it("removeItemFromList: 進行中なら削除して success", async () => {
    sync.getItem.mockResolvedValue({ id: ID, listId: "l" })
    sync.getList.mockResolvedValue({ status: "in_progress" })
    expect(await caller().removeItemFromList({ id: ID })).toEqual({ success: true })
    expect(sync.removeItem).toHaveBeenCalledWith(ID, "user-1")
  })

  it("checkItem: チェック状態を更新する", async () => {
    sync.getItem.mockResolvedValue({ id: ID, listId: "l" })
    sync.getList.mockResolvedValue({ status: "in_progress" })
    sync.updateItem.mockResolvedValue({ id: ID, checked: true })
    await caller().checkItem({ listItemId: ID, checked: true })
    expect(sync.updateItem).toHaveBeenCalledWith({ id: ID, checked: true }, "user-1")
  })
})

describe("shopping.finishShopping", () => {
  it("権限なしは FORBIDDEN", async () => {
    sync.canAccessList.mockResolvedValue(false)
    await expect(caller().finishShopping({ listId: ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("業務ルール違反は BAD_REQUEST にしてメッセージを返す", async () => {
    shopping.finishShopping.mockRejectedValue(new ShoppingDomainError("チェック済みがありません"))
    await expect(caller().finishShopping({ listId: ID })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "チェック済みがありません" })
  })

  it("それ以外のエラーは BAD_REQUEST にせず INTERNAL_SERVER_ERROR として投げ直す（文言の置き換えは errorFormatter の役目）", async () => {
    shopping.finishShopping.mockRejectedValue(new Error("connection refused 10.0.0.1"))
    const err = await caller().finishShopping({ listId: ID }).catch((e) => e)
    expect(err.code).toBe("INTERNAL_SERVER_ERROR")
  })

  it("成功したら場所つきで完了する", async () => {
    shopping.finishShopping.mockResolvedValue({ ok: true })
    expect(await caller().finishShopping({ listId: ID, location: "スーパー" })).toEqual({ ok: true })
    expect(shopping.finishShopping).toHaveBeenCalledWith(ID, "user-1", "スーパー")
  })
})

describe("shopping の履歴", () => {
  it("getHistory: メンバーでないグループは FORBIDDEN", async () => {
    groupRepo.isMember.mockResolvedValue(false)
    await expect(caller().getHistory({ groupId: GID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("getHistory: 通れば取得する", async () => {
    sync.getHistory.mockResolvedValue([])
    await caller().getHistory({})
    expect(sync.getHistory).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", groupId: undefined }))
  })

  it("getHistoryById: 権限なしは FORBIDDEN", async () => {
    sync.canAccessHistory.mockResolvedValue(false)
    await expect(caller().getHistoryById({ id: ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("getHistoryById: なければ NOT_FOUND", async () => {
    sync.getHistoryById.mockResolvedValue(null)
    await expect(caller().getHistoryById({ id: ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("getHistoryById: あれば返す", async () => {
    sync.getHistoryById.mockResolvedValue({ id: ID })
    expect(await caller().getHistoryById({ id: ID })).toEqual({ id: ID })
  })

  describe("revertHistory", () => {
    it("権限なしは FORBIDDEN", async () => {
      sync.canAccessHistory.mockResolvedValue(false)
      await expect(caller().revertHistory({ historyId: ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    })

    it("履歴がなければ NOT_FOUND", async () => {
      sync.getHistoryById.mockResolvedValue(null)
      await expect(caller().revertHistory({ historyId: ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
    })

    it("取り消しは ShoppingService に任せ、戻したリストと戻したカタログアイテムの ID を返す", async () => {
      sync.getHistoryById.mockResolvedValue({ id: ID, items: [{ name: "牛乳" }] })
      shopping.revertHistory.mockResolvedValue({ list: { id: ID }, revertedItemIds: ["c1", "c2"] })
      const res = await caller().revertHistory({ historyId: ID })
      expect(res).toEqual({ success: true, list: { id: ID }, revertedItemIds: ["c1", "c2"] })
      expect(shopping.revertHistory).toHaveBeenCalledWith(ID, "user-1")
    })

    it("トランザクションの中で取り消せなければ（使えない・購入履歴でない）NOT_FOUND", async () => {
      sync.getHistoryById.mockResolvedValue({ id: ID, items: [{ name: "牛乳" }] })
      shopping.revertHistory.mockResolvedValue(null)
      await expect(caller().revertHistory({ historyId: ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "履歴が見つかりません",
      })
    })
  })

  describe("deleteHistory", () => {
    it("権限なしは FORBIDDEN", async () => {
      sync.canAccessHistory.mockResolvedValue(false)
      await expect(caller().deleteHistory({ id: ID })).rejects.toMatchObject({ code: "FORBIDDEN" })
    })

    it("履歴がなければ NOT_FOUND", async () => {
      sync.getHistoryById.mockResolvedValue(null)
      await expect(caller().deleteHistory({ id: ID })).rejects.toMatchObject({ code: "NOT_FOUND" })
    })

    // 履歴の削除は、カタログのアイテムの削除をコールバックで受け取り、同じトランザクションで行う（#62 O3b）
    const runDeleteCallback = () =>
      sync.deleteHistory.mockImplementation(
        async (_id: string, _userId: string, deleteCatalogItems: (tx: unknown) => Promise<string[]>) =>
          deleteCatalogItems("tx")
      )

    it("対応するカタログアイテムを消し、delete の同期ログを残して履歴を削除する", async () => {
      sync.getHistoryById.mockResolvedValue({ items: [{ name: "牛乳" }] })
      scope.getListScope.mockResolvedValue({ userId: "user-1", groupId: null })
      scope.deleteScopedItemsByName.mockResolvedValue(["c1"])
      runDeleteCallback()
      expect(await caller().deleteHistory({ id: ID })).toEqual({ success: true })
      expect(syncRepo.createOperation).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: "c1", operation: "delete", payload: { id: "c1" } })
      )
      expect(sync.deleteHistory).toHaveBeenCalledWith(ID, "user-1", expect.any(Function))
      // カタログのアイテムの削除は、履歴の削除のトランザクションの中で行う
      expect(scope.getListScope).toHaveBeenCalledWith("tx", ID)
      expect(scope.deleteScopedItemsByName).toHaveBeenCalledWith("tx", { userId: "user-1", groupId: null }, "牛乳")
    })

    it("スコープが分からなければカタログは消さず履歴だけ削除する", async () => {
      sync.getHistoryById.mockResolvedValue({ items: [{ name: "牛乳" }] })
      scope.getListScope.mockResolvedValue(null)
      runDeleteCallback()
      await caller().deleteHistory({ id: ID })
      expect(scope.deleteScopedItemsByName).not.toHaveBeenCalled()
      expect(sync.deleteHistory).toHaveBeenCalled()
    })
  })
})
