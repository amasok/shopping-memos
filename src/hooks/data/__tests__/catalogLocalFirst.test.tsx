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
      useUtils: () => ({ catalog: { getItems: { invalidate: state.invalidateItems }, getTags: { invalidate: vi.fn() } } }),
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
    },
  }
})

import { resolveCatalogMode, useCatalogSource } from "../useCatalogSource"
import { useItems } from "../useItems"
import { useTags } from "../useTags"
import { useItemMutations } from "../useItemMutations"
import { useGroups } from "../useGroups"

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

describe("買い物の変更の後の同期（refreshCatalog）", () => {
  it("ローカルファーストでリストに商品を入れると同期する", () => {
    loginLocalFirst()
    const { result } = renderHook(() => useCatalogSource())

    result.current.refreshCatalog()

    expect(state.sync).toHaveBeenCalledTimes(1)
    expect(state.invalidateItems).not.toHaveBeenCalled()
  })

  it("サーバーファーストではカタログのキャッシュを無効にする", () => {
    state.user = USER
    state.isMergeCompleted = true
    const { result } = renderHook(() => useCatalogSource())

    result.current.refreshCatalog()

    expect(state.invalidateItems).toHaveBeenCalledTimes(1)
    expect(state.sync).not.toHaveBeenCalled()
  })

  it("ゲストでは何もしない（一覧は端末の DB を追う）", () => {
    const { result } = renderHook(() => useCatalogSource())
    result.current.refreshCatalog()
    expect(state.invalidateItems).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
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
