import { describe, it, expect, vi, beforeEach } from "vitest"

const cleared = vi.hoisted(() => [] as string[])
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
  MERGE_COMPLETED_KEY,
  SELECTED_GROUP_KEY,
  clearGuestData,
  clearLoginScopedState,
  hasGuestDataToMerge,
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
