import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { ShoppingMemosDB, db as guestDb } from "@/lib/db"
import { createClock } from "@/infrastructure/local/clock"

/**
 * カタログの hooks の経路（#62 O7。openspec の catalog・sync）
 *
 * コンテキストと tRPC をモックし、ゲスト DB（本物の singleton を fake-indexeddb で）とユーザー DB（テスト用）を使う
 */
const state = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; email: string },
  isMergeCompleted: false,
  localFirst: false,
  selectedGroupId: undefined as string | undefined,
  engine: null as null | { getClock: () => unknown; sync: () => Promise<void> },
  lastSyncAt: null as Date | null,
  userDb: null as unknown,
  requestSync: vi.fn(),
  sync: vi.fn(async () => {}),
  invalidateItems: vi.fn(async () => {}),
  getItemsQuery: vi.fn(),
  getTagsQuery: vi.fn(),
  getGroupsQuery: vi.fn(),
  createItemMutate: vi.fn(async () => ({ id: "server-item" })),
  createListMutate: vi.fn(async () => ({ id: "server-list" })),
  getListsQuery: vi.fn(),
  getHistoryQuery: vi.fn(),
}))

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, isLoading: false }) }))
vi.mock("@/contexts/GroupContext", () => ({ useGroup: () => ({ selectedGroupId: state.selectedGroupId }) }))
vi.mock("@/contexts/DataMergeContext", () => ({ useDataMerge: () => ({ isMergeCompleted: state.isMergeCompleted }) }))
vi.mock("@/contexts/SyncContext", () => ({
  useSync: () => ({ engine: state.engine, requestSync: state.requestSync, sync: state.sync, lastSyncAt: state.lastSyncAt }),
}))
vi.mock("@/lib/featureFlags", () => ({ isLocalFirstEnabled: () => state.localFirst }))
vi.mock("@/lib/db/userDb", () => ({ getUserDb: () => state.userDb }))
vi.mock("@/infrastructure/trpc/client", () => {
  const query = (fn: (...args: unknown[]) => unknown) => ({
    useQuery: (input: unknown, opts: { enabled?: boolean }) => {
      fn(input, opts)
      return { data: opts?.enabled ? [] : undefined, isLoading: false, error: null, refetch: vi.fn() }
    },
  })
  const mutation = (mutateAsync: (...args: unknown[]) => unknown = async () => ({})) => ({
    useMutation: () => ({ mutateAsync, isPending: false }),
  })
  return {
    trpc: {
      useUtils: () => ({
        catalog: { getItems: { invalidate: state.invalidateItems }, getTags: { invalidate: vi.fn() } },
        shopping: {
          getLists: { invalidate: vi.fn() },
          getList: { invalidate: vi.fn() },
          getHistory: { invalidate: vi.fn() },
        },
      }),
      catalog: {
        getItems: query(state.getItemsQuery),
        getTags: query(state.getTagsQuery),
        createItem: mutation((...args) => state.createItemMutate(...(args as []))),
        updateItem: mutation(),
        deleteItem: mutation(),
        createTag: mutation(),
        updateTag: mutation(),
        deleteTag: mutation(),
      },
      identity: {
        getGroups: query(state.getGroupsQuery),
        getGroupMembers: query(vi.fn()),
      },
      shopping: {
        getLists: query(state.getListsQuery),
        getList: query(vi.fn()),
        getHistory: query(state.getHistoryQuery),
        createList: mutation((...args) => state.createListMutate(...(args as []))),
        updateList: mutation(),
        deleteList: mutation(),
        addItemToList: mutation(),
        addNewItemToList: mutation(),
        removeItemFromList: mutation(),
        checkItem: mutation(),
        finishShopping: mutation(),
        revertHistory: mutation(),
        deleteHistory: mutation(),
      },
    },
  }
})

import { resolveCatalogMode, useCatalogSource } from "../useCatalogSource"
import { useItems } from "../useItems"
import { useTags } from "../useTags"
import { useItemMutations } from "../useItemMutations"
import { useGroups } from "../useGroups"
import { useList, useLists, useListsWithItems } from "../useLists"
import { useHistory } from "../useHistory"
import { useListMutations } from "../useListMutations"
import { useHistoryMutations } from "../useHistoryMutations"

const USER = { id: "user-1", name: "U", email: "u@example.com" }
let userDb: ShoppingMemosDB

function loginLocalFirst() {
  state.user = USER
  state.isMergeCompleted = true
  state.localFirst = true
  state.engine = { getClock: () => createClock(0), sync: state.sync }
  state.lastSyncAt = new Date()
}

beforeEach(async () => {
  state.user = null
  state.isMergeCompleted = false
  state.localFirst = false
  state.selectedGroupId = undefined
  state.engine = null
  state.lastSyncAt = null
  userDb = new ShoppingMemosDB(`user-db-test-${crypto.randomUUID()}`)
  state.userDb = userDb
  vi.clearAllMocks()
  await Promise.all(guestDb.tables.map((t) => t.clear()))
})

afterEach(async () => {
  await userDb.delete()
})

describe("resolveCatalogMode", () => {
  it("ログインしていなければ、または merge の前ならゲスト", () => {
    expect(resolveCatalogMode({ isLoggedIn: false, isMergeCompleted: false, localFirst: true })).toBe("guest")
    expect(resolveCatalogMode({ isLoggedIn: true, isMergeCompleted: false, localFirst: true })).toBe("guest")
  })

  it("ログイン中で merge 済みなら、フラグで server と local に分かれる", () => {
    expect(resolveCatalogMode({ isLoggedIn: true, isMergeCompleted: true, localFirst: false })).toBe("server")
    expect(resolveCatalogMode({ isLoggedIn: true, isMergeCompleted: true, localFirst: true })).toBe("local")
  })
})

describe("モードによる読み書きの経路", () => {
  it("ゲストはゲスト DB を読み書きする", async () => {
    const { result } = renderHook(() => ({ items: useItems(), mutations: useItemMutations() }))

    await act(async () => {
      await result.current.mutations.createItem({ name: "牛乳", quantity: 1, tagIds: [] })
    })

    await waitFor(() => expect(result.current.items.items.map((i) => i.name)).toEqual(["牛乳"]))
    expect(await guestDb.items.count()).toBe(1)
    expect(await guestDb.syncQueue.count()).toBe(0)
    expect(state.createItemMutate).not.toHaveBeenCalled()
    expect(state.requestSync).not.toHaveBeenCalled()
  })

  it("フラグが false ならログイン中はサーバーを読み書きする", async () => {
    state.user = USER
    state.isMergeCompleted = true
    const { result } = renderHook(() => ({ items: useItems(), mutations: useItemMutations() }))

    await act(async () => {
      await result.current.mutations.createItem({ name: "牛乳", quantity: 1, tagIds: [] })
    })

    expect(state.createItemMutate).toHaveBeenCalledWith(expect.objectContaining({ name: "牛乳" }))
    expect(state.getItemsQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true }))
    expect(await guestDb.items.count()).toBe(0)
    expect(await userDb.items.count()).toBe(0)
  })

  it("フラグが true ならログイン中はユーザー DB を読み書きする", async () => {
    loginLocalFirst()
    const { result } = renderHook(() => ({ items: useItems(), mutations: useItemMutations() }))

    await act(async () => {
      await result.current.mutations.createItem({ name: "牛乳", quantity: 1, tagIds: [] })
    })

    await waitFor(() => expect(result.current.items.items.map((i) => i.name)).toEqual(["牛乳"]))
    expect(await userDb.items.count()).toBe(1)
    expect(await userDb.syncQueue.count()).toBe(1)
    expect(await guestDb.items.count()).toBe(0)
    expect(state.createItemMutate).not.toHaveBeenCalled()
    // tRPC のカタログの一覧は有効にしない
    expect(state.getItemsQuery).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true }))
    // 書き込みの後に同期を予約する
    expect(state.requestSync).toHaveBeenCalledTimes(1)
  })

  it("同期エンジンができる前は、書き込みを受けずにエラーにする", async () => {
    loginLocalFirst()
    state.engine = null
    const { result } = renderHook(() => useItemMutations())

    await expect(result.current.createItem({ name: "牛乳", quantity: 1, tagIds: [] })).rejects.toThrow("準備中です")
    expect(await userDb.items.count()).toBe(0)
  })
})

describe("初回の同期が終わるまでの一覧", () => {
  it("初回の同期の前は読み込み中", async () => {
    loginLocalFirst()
    state.lastSyncAt = null
    await userDb.items.add({ id: "i1", name: "牛乳", quantity: 1, tagIds: [], createdAt: new Date(), updatedAt: new Date() })

    const { result } = renderHook(() => ({ items: useItems(), tags: useTags() }))

    await waitFor(() => expect(result.current.items.items).toHaveLength(1))
    expect(result.current.items.isLoading).toBe(true)
    expect(result.current.tags.isLoading).toBe(true)
  })

  it("初回の同期の後はユーザー DB の一覧を出す", async () => {
    loginLocalFirst()
    await userDb.items.add({ id: "i1", name: "牛乳", quantity: 1, tagIds: [], createdAt: new Date(), updatedAt: new Date() })
    await userDb.tags.add({ id: "t1", name: "食品", createdAt: new Date(), updatedAt: new Date() })

    const { result } = renderHook(() => ({ items: useItems(), tags: useTags() }))

    await waitFor(() => expect(result.current.items.isLoading).toBe(false))
    expect(result.current.items.items.map((i) => i.name)).toEqual(["牛乳"])
    await waitFor(() => expect(result.current.tags.tags.map((t) => t.name)).toEqual(["食品"]))
    expect(result.current.tags.isLoading).toBe(false)
  })
})

describe("サーバーファーストの買い物の変更の後のカタログ（refreshCatalog）", () => {
  it("サーバーファーストではカタログのキャッシュを無効にする", () => {
    state.user = USER
    state.isMergeCompleted = true
    const { result } = renderHook(() => useCatalogSource())

    result.current.refreshCatalog()

    expect(state.invalidateItems).toHaveBeenCalledTimes(1)
    expect(state.sync).not.toHaveBeenCalled()
  })

  it("ゲスト・ローカルファーストでは何もしない（一覧は端末の DB を追う）", () => {
    const guest = renderHook(() => useCatalogSource())
    guest.result.current.refreshCatalog()
    loginLocalFirst()
    const local = renderHook(() => useCatalogSource())
    local.result.current.refreshCatalog()

    expect(state.invalidateItems).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
  })

  it("ローカルファーストではリストに入れた商品が一覧からすぐに消える", async () => {
    loginLocalFirst()
    const { result } = renderHook(() => ({ items: useItems(), lists: useListMutations() }))
    await act(async () => {
      await userDb.items.add({ id: "i1", name: "牛乳", quantity: 1, tagIds: [], createdAt: new Date(), updatedAt: new Date() })
    })
    await waitFor(() => expect(result.current.items.items.map((i) => i.id)).toEqual(["i1"]))

    await act(async () => {
      await result.current.lists.createList({ name: "買い物", itemIds: ["i1"] })
    })

    await waitFor(() => expect(result.current.items.items).toEqual([]))
    expect(state.sync).not.toHaveBeenCalled()
  })
})

describe("買い物の読み書きの経路", () => {
  it("フラグが true ならリストの作成はユーザー DB に書きキューに積む", async () => {
    loginLocalFirst()
    const { result } = renderHook(() => ({ lists: useLists(), mutations: useListMutations() }))

    await act(async () => {
      await result.current.mutations.createList({ name: "買い物" })
    })

    await waitFor(() => expect(result.current.lists.lists.map((l) => l.name)).toEqual(["買い物"]))
    expect(await userDb.lists.count()).toBe(1)
    expect((await userDb.syncQueue.toArray()).map((o) => [o.entity, o.type])).toEqual([["list", "create"]])
    expect(state.requestSync).toHaveBeenCalledTimes(1)
    expect(state.createListMutate).not.toHaveBeenCalled()
    expect(state.getListsQuery).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true }))
  })

  it("フラグが false ならリストの作成はサーバーに送る", async () => {
    state.user = USER
    state.isMergeCompleted = true
    const { result } = renderHook(() => ({ lists: useLists(), mutations: useListMutations() }))

    await act(async () => {
      await result.current.mutations.createList({ name: "買い物" })
    })

    expect(state.createListMutate).toHaveBeenCalledWith(expect.objectContaining({ name: "買い物" }))
    expect(state.getListsQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true }))
    expect(await userDb.lists.count()).toBe(0)
    expect(await guestDb.lists.count()).toBe(0)
  })

  it("ゲストのリストの作成はゲスト DB に書きキューに積まない", async () => {
    const { result } = renderHook(() => ({ lists: useLists(), mutations: useListMutations() }))

    await act(async () => {
      await result.current.mutations.createList({ name: "買い物" })
    })

    await waitFor(() => expect(result.current.lists.lists.map((l) => l.name)).toEqual(["買い物"]))
    expect(await guestDb.syncQueue.count()).toBe(0)
    expect(state.createListMutate).not.toHaveBeenCalled()
    expect(state.requestSync).not.toHaveBeenCalled()
  })

  it("ローカルファーストで初回の同期の前は買い物の一覧も読み込み中", async () => {
    loginLocalFirst()
    state.lastSyncAt = null
    await userDb.lists.add({ id: "l1", name: "買い物", status: "in_progress", createdAt: new Date() })

    const { result } = renderHook(() => ({ lists: useLists(), history: useHistory() }))

    await waitFor(() => expect(result.current.lists.lists).toHaveLength(1))
    expect(result.current.lists.isLoading).toBe(true)
    expect(result.current.history.isLoading).toBe(true)
  })
})

describe("買い物の hooks（端末の DB）", () => {
  it("ローカルファーストで、リストの詳細と商品つきの一覧をユーザー DB から作成日時の古い順に出す", async () => {
    loginLocalFirst()
    await userDb.lists.add({ id: "l1", name: "買い物", status: "in_progress", createdAt: new Date(1) })
    await userDb.listItems.add({ id: "b", listId: "l1", name: "卵", quantity: 1, tagIds: [], checked: false, createdAt: new Date(2) })
    await userDb.listItems.add({ id: "a", listId: "l1", name: "牛乳", quantity: 1, tagIds: [], checked: false, createdAt: new Date(3) })

    const { result } = renderHook(() => ({ detail: useList({ listId: "l1" }), withItems: useListsWithItems() }))

    await waitFor(() => expect(result.current.detail.isLoading).toBe(false))
    expect(result.current.detail.list?.name).toBe("買い物")
    expect(result.current.detail.items.map((i) => i.id)).toEqual(["b", "a"])
    await waitFor(() => expect(result.current.withItems.isLoading).toBe(false))
    expect(result.current.withItems.lists.map((l) => l.id)).toEqual(["l1"])
    expect(result.current.withItems.listItems.map((i) => i.id)).toEqual(["b", "a"])
  })

  it("ローカルファーストで、hooks から完了・取り消し・削除をすると複合操作と削除をキューに積み、同期を予約する", async () => {
    loginLocalFirst()
    const { result } = renderHook(() => ({ lists: useListMutations(), history: useHistoryMutations() }))
    let listId = ""
    await act(async () => {
      listId = (await result.current.lists.createList({ name: "買い物" }))!.id
      await result.current.lists.addNewItemToList({ listId, name: "牛乳" })
      const [entry] = await userDb.listItems.toArray()
      await result.current.lists.checkItem(entry.id, true)
      await result.current.lists.updateList({ id: listId, name: "週末" })
    })
    await userDb.syncQueue.clear()

    await act(async () => {
      await result.current.lists.finishShopping(listId)
      await result.current.history.revertHistory(listId)
    })
    expect((await userDb.syncQueue.orderBy("seq").toArray()).map((o) => o.type)).toEqual(["finishShopping", "revertHistory"])

    const [entry] = await userDb.listItems.toArray()
    await act(async () => {
      await result.current.lists.checkItem(entry.id, true)
      await result.current.lists.finishShopping(listId)
      await result.current.history.deleteHistory(listId)
    })
    expect(await userDb.lists.count()).toBe(0)
    expect(state.requestSync).toHaveBeenCalled()
  })

  it("ゲストの hooks の完了は今の規則（チェック 0 件はエラー）", async () => {
    const { result } = renderHook(() => useListMutations())
    let listId = ""
    await act(async () => {
      listId = (await result.current.createList({ name: "買い物" }))!.id
      await result.current.addNewItemToList({ listId, name: "牛乳" })
    })

    await expect(result.current.finishShopping(listId)).rejects.toThrow("購入済みのアイテムがありません")

    const [entry] = await guestDb.listItems.toArray()
    await act(async () => {
      await result.current.removeItemFromList(entry.id)
      await result.current.deleteList(listId)
    })
    expect(await guestDb.lists.count()).toBe(0)
    expect(await guestDb.syncQueue.count()).toBe(0)
  })
})

describe("ローカルファーストのグループの一覧", () => {
  it("グループの一覧はキャッシュから出す", async () => {
    loginLocalFirst()
    await userDb.groups.put({
      id: "g1",
      name: "家族",
      ownerId: "",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      memberCount: 2,
    })

    const { result } = renderHook(() => useGroups())

    await waitFor(() => expect(result.current.groups.map((g) => [g.name, g.memberCount])).toEqual([["家族", 2]]))
    expect(result.current.isLoading).toBe(false)
    expect(state.getGroupsQuery).not.toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: true }))
  })

  it("グループを作った後に同期して一覧に出す（refetch は同期）", async () => {
    loginLocalFirst()
    const { result } = renderHook(() => useGroups())

    await act(async () => {
      await result.current.refetch()
    })

    expect(state.sync).toHaveBeenCalledTimes(1)
  })

  it("フラグが false なら、ログイン中のグループの一覧は tRPC から", () => {
    state.user = USER
    state.isMergeCompleted = true
    renderHook(() => useGroups())
    expect(state.getGroupsQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: true }))
  })
})
