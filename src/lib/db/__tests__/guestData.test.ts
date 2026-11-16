import { describe, it, expect, vi, beforeEach } from "vitest"

const cleared = vi.hoisted(() => [] as string[])
const seeded = vi.hoisted(() => ({ count: 0 }))
vi.mock("../tags", () => ({
  DEFAULT_TAG_NAMES: ["食品", "日用品", "エンタメ"],
  initializeDefaultTags: async () => {
    seeded.count++
  },
}))
vi.mock("../index", () => {
  const table = (name: string) => ({ clear: async () => void cleared.push(name) })
  const tables = { tags: table("tags"), items: table("items"), lists: table("lists"), listItems: table("listItems") }
  return {
    db: {
      ...tables,
      table: (name: string) => table(name),
      transaction: async (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn(),
    },
    generateId: () => "id",
  }
})

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

const tags = (...names: string[]) => names.map((name) => ({ name }))
const empty = { tags: [], items: [], lists: [], listItems: [] }

describe("hasGuestDataToMerge", () => {
  it("初期タグ（食品・日用品・エンタメ）だけなら送らない", () => {
    expect(hasGuestDataToMerge({ ...empty, tags: tags("食品", "日用品", "エンタメ") })).toBe(false)
    expect(hasGuestDataToMerge({ ...empty, tags: tags("食品") })).toBe(false)
    expect(hasGuestDataToMerge(empty)).toBe(false)
  })

  it("初期タグ以外のタグがあれば送る", () => {
    expect(hasGuestDataToMerge({ ...empty, tags: tags("食品", "お気に入り") })).toBe(true)
  })

  it.each(["items", "lists", "listItems"] as const)("%s が 1 件でもあれば送る", (key) => {
    expect(hasGuestDataToMerge({ ...empty, tags: tags("食品"), [key]: [{}] })).toBe(true)
  })
})

describe("clearGuestData", () => {
  beforeEach(() => {
    cleared.length = 0
  })

  it("ゲストのデータ（タグ・アイテム・リスト・リストアイテム・履歴）をすべて消す", async () => {
    await clearGuestData()
    expect(cleared.sort()).toEqual(["history", "items", "listItems", "lists", "tags"])
  })
})

describe("clearLoginScopedState", () => {
  beforeEach(() => localStorage.clear())

  it("merge 済みの印（全ユーザー分）と選んでいたグループを消し、ほかの値は残す", () => {
    localStorage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")
    localStorage.setItem(`${MERGE_COMPLETED_KEY}-user-2`, "true")
    localStorage.setItem(SELECTED_GROUP_KEY, "group-1")
    localStorage.setItem("data-merge-skipped-user-1", "2")
    localStorage.setItem("other", "keep")

    clearLoginScopedState()

    expect(localStorage.getItem(`${MERGE_COMPLETED_KEY}-user-1`)).toBeNull()
    expect(localStorage.getItem(`${MERGE_COMPLETED_KEY}-user-2`)).toBeNull()
    expect(localStorage.getItem(SELECTED_GROUP_KEY)).toBeNull()
    // 取り込めなかった件数の通知は、閉じるまで残す
    expect(localStorage.getItem("data-merge-skipped-user-1")).toBe("2")
    expect(localStorage.getItem("other")).toBe("keep")
  })
})

describe("migrateLegacyGuestData（以前の仕組みからの移行）", () => {
  beforeEach(() => {
    localStorage.clear()
    cleared.length = 0
    seeded.count = 0
  })

  it("以前の merge 済みの印がある端末では、ゲストのデータを送らずに空にし、初期タグだけに戻す", async () => {
    localStorage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")

    expect(await migrateLegacyGuestData()).toBe("cleared")
    expect(cleared.sort()).toEqual(["history", "items", "listItems", "lists", "tags"])
    expect(seeded.count).toBe(1)
    expect(localStorage.getItem(GUEST_DATA_VERSION_KEY)).toBe(GUEST_DATA_VERSION)
    // 印そのものは残す（このログインの間は merge 済み、という新しい意味でそのまま使える）
    expect(localStorage.getItem(`${MERGE_COMPLETED_KEY}-user-1`)).toBe("true")
  })

  it("以前の印がない端末（まだ merge していないゲスト）は、データを残してバージョンだけを付ける", async () => {
    expect(await migrateLegacyGuestData()).toBe("none")
    expect(cleared).toEqual([])
    expect(seeded.count).toBe(0)
    expect(localStorage.getItem(GUEST_DATA_VERSION_KEY)).toBe(GUEST_DATA_VERSION)
  })

  it("一度だけ: 移行済みの端末では、新しい意味の印があってもゲストのデータを消さない", async () => {
    localStorage.setItem(GUEST_DATA_VERSION_KEY, GUEST_DATA_VERSION)
    localStorage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")

    expect(await migrateLegacyGuestData()).toBe("none")
    expect(cleared).toEqual([])
  })

  it("2 回目の呼び出しでは何もしない", async () => {
    localStorage.setItem(`${MERGE_COMPLETED_KEY}-user-1`, "true")
    await migrateLegacyGuestData()
    cleared.length = 0
    expect(await migrateLegacyGuestData()).toBe("none")
    expect(cleared).toEqual([])
  })
})

describe("ensureGuestDataMigrated", () => {
  it("1 回のページの読み込みで 1 回だけ移行する（同じ Promise を返す）", () => {
    localStorage.clear()
    expect(ensureGuestDataMigrated()).toBe(ensureGuestDataMigrated())
  })
})
