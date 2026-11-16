// @vitest-environment node
// 本物の Dexie と実際のスキーマ（ShoppingMemosDB）で確かめる。db をモックすると、
// 廃止したテーブル（v8 の history）を触るような、スキーマとの食い違いに気づけないため
import "fake-indexeddb/auto"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { db } from "../index"
import {
  GUEST_DATA_VERSION,
  GUEST_DATA_VERSION_KEY,
  MERGE_COMPLETED_KEY,
  SELECTED_GROUP_KEY,
  clearGuestData,
  clearLoginScopedState,
  ensureGuestDataMigrated,
  hasGuestDataToMerge,
  migrateLegacyGuestData,
} from "../guestData"
import { DEFAULT_TAG_NAMES } from "../tags"

/** localStorage の代わり（node の環境にはない） */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const NOW = new Date("2026-03-01T09:00:00Z")

/** ゲストのデータを、DB のすべてのテーブルに 1 件ずつ入れる */
async function seedEveryTable() {
  await db.tags.add({ id: "t1", name: "お気に入り", createdAt: NOW, updatedAt: NOW } as never)
  await db.items.add({ id: "i1", name: "牛乳", quantity: 1, tagIds: ["t1"], createdAt: NOW, updatedAt: NOW } as never)
  await db.lists.add({ id: "l1", name: "週末", status: "in_progress", createdAt: NOW, updatedAt: NOW } as never)
  await db.listItems.add({ id: "li1", listId: "l1", name: "牛乳", quantity: 1, tagIds: [], checked: false, createdAt: NOW } as never)
  await db.groups.add({ id: "g1", name: "家族", ownerId: "u1", inviteCode: "ABC", createdAt: NOW } as never)
  await db.groupMembers.add({ id: "gm1", groupId: "g1", userId: "u1" } as never)
  await db.syncQueue.add({ id: "q1", entity: "item", entityId: "i1", operation: "create", payload: {}, createdAt: NOW, retryCount: 0 } as never)
}

async function rowCounts(): Promise<Record<string, number>> {
  return Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.count()] as const)))
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ゲストの DB のスキーマ", () => {
  it("廃止したテーブル（v8 の history）は、現在のスキーマにない", () => {
    expect(db.tables.map((t) => t.name)).not.toContain("history")
  })
})

describe("clearGuestData（本物の Dexie）", () => {
  it("DB のすべてのテーブルを空にし、初期タグだけを作り直す", async () => {
    await seedEveryTable()
    // 入れたデータが、すべてのテーブルに入っていることを先に確かめる
    for (const [name, count] of Object.entries(await rowCounts())) {
      expect(count, `${name} にデータが入っていない`).toBeGreaterThan(0)
    }

    await clearGuestData()

    for (const [name, count] of Object.entries(await rowCounts())) {
      if (name !== "tags") expect(count, `${name} が空になっていない`).toBe(0)
    }
    const tags = await db.tags.toArray()
    expect(tags.map((t) => t.name).sort()).toEqual([...DEFAULT_TAG_NAMES].sort())
  })
})

describe("migrateLegacyGuestData（本物の Dexie）", () => {
  it("以前の merge 済みの印がある端末では、ゲストのデータを送らずに空にし、初期タグだけに戻す", async () => {
    const storage = memoryStorage()
    storage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")
    await seedEveryTable()

    expect(await migrateLegacyGuestData(storage)).toBe("cleared")

    expect(await db.items.count()).toBe(0)
    expect(await db.lists.count()).toBe(0)
    expect((await db.tags.toArray()).map((t) => t.name).sort()).toEqual([...DEFAULT_TAG_NAMES].sort())
    expect(storage.getItem(GUEST_DATA_VERSION_KEY)).toBe(GUEST_DATA_VERSION)
  })

  it("以前の印がない端末（まだ merge していないゲスト）は、データを残してバージョンだけを付ける", async () => {
    const storage = memoryStorage()
    await seedEveryTable()

    expect(await migrateLegacyGuestData(storage)).toBe("none")

    expect(await db.items.count()).toBe(1)
    expect(storage.getItem(GUEST_DATA_VERSION_KEY)).toBe(GUEST_DATA_VERSION)
  })

  it("一度だけ: 移行済みの端末では、新しい意味の印があってもゲストのデータを消さない", async () => {
    const storage = memoryStorage()
    storage.setItem(GUEST_DATA_VERSION_KEY, GUEST_DATA_VERSION)
    storage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")
    await seedEveryTable()

    expect(await migrateLegacyGuestData(storage)).toBe("none")
    expect(await db.items.count()).toBe(1)
  })

  it("消すのに失敗したら、バージョンを付けず、以前の印も残す（次の読み込みでやり直す）", async () => {
    const storage = memoryStorage()
    storage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")
    vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("quota"))

    await expect(migrateLegacyGuestData(storage)).rejects.toThrow("quota")
    expect(storage.getItem(GUEST_DATA_VERSION_KEY)).toBeNull()
    expect(storage.getItem(`${MERGE_COMPLETED_KEY}-user-1`)).toBe("true")
  })
})

describe("ensureGuestDataMigrated", () => {
  it("失敗したら false を返し、次の呼び出しでやり直す。成功したら true を返し、以後は同じ Promise を返す", async () => {
    const storage = memoryStorage()
    vi.stubGlobal("localStorage", storage)
    storage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("quota"))

    expect(await ensureGuestDataMigrated()).toBe(false)
    expect(storage.getItem(GUEST_DATA_VERSION_KEY)).toBeNull()

    const retry = ensureGuestDataMigrated()
    expect(ensureGuestDataMigrated()).toBe(retry)
    expect(await retry).toBe(true)
    expect(storage.getItem(GUEST_DATA_VERSION_KEY)).toBe(GUEST_DATA_VERSION)
  })
})

describe("hasGuestDataToMerge", () => {
  const tags = (...names: string[]) => names.map((name) => ({ name }))
  const empty = { tags: [], items: [], lists: [], listItems: [] }

  it("初期タグ（食品・日用品・エンタメ）だけなら送らない", () => {
    expect(hasGuestDataToMerge({ ...empty, tags: tags(...DEFAULT_TAG_NAMES) })).toBe(false)
    expect(hasGuestDataToMerge(empty)).toBe(false)
  })

  it("初期タグ以外のタグがあれば送る", () => {
    expect(hasGuestDataToMerge({ ...empty, tags: tags("食品", "お気に入り") })).toBe(true)
  })

  it.each(["items", "lists", "listItems"] as const)("%s が 1 件でもあれば送る", (key) => {
    expect(hasGuestDataToMerge({ ...empty, tags: tags("食品"), [key]: [{}] })).toBe(true)
  })
})

describe("clearLoginScopedState", () => {
  it("merge 済みの印（全ユーザー分）と選んでいたグループを消し、ほかの値は残す", () => {
    const storage = memoryStorage()
    storage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")
    storage.setItem(`${MERGE_COMPLETED_KEY}-user-2`, "true")
    storage.setItem(SELECTED_GROUP_KEY, "group-1")
    storage.setItem("data-merge-skipped-user-1", "2")
    storage.setItem(GUEST_DATA_VERSION_KEY, GUEST_DATA_VERSION)

    clearLoginScopedState(storage)

    expect(storage.getItem(`${MERGE_COMPLETED_KEY}-user-1`)).toBeNull()
    expect(storage.getItem(`${MERGE_COMPLETED_KEY}-user-2`)).toBeNull()
    expect(storage.getItem(SELECTED_GROUP_KEY)).toBeNull()
    // 取り込めなかった件数の通知（閉じるまで）と、移行済みのバージョンは残す
    expect(storage.getItem("data-merge-skipped-user-1")).toBe("2")
    expect(storage.getItem(GUEST_DATA_VERSION_KEY)).toBe(GUEST_DATA_VERSION)
  })
})
