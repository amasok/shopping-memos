import { describe, it, expect, vi } from "vitest"
import { createFakeTagDb, type TagRow } from "./helpers/fakeTagDb"

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fakeTagDb").createFakeTagDb>,
}))

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: new Proxy({}, { get: (_t, prop) => (state.fake.db as never)[prop] }),
}))

import { DataMergeService, type MergeData } from "@/modules/sync/application/services/DataMergeService"

const ME = "user-me"
const NOW = new Date("2026-01-01T00:00:00Z")
const GROUP = "g1"

const item = (tagIds: string[]) => ({ id: "item-1", name: "牛乳", quantity: 1, tagIds, createdAt: NOW })
const data = (over: Partial<MergeData>): MergeData => ({ items: [], tags: [], lists: [], listItems: [], history: [], ...over })
const setup = (map: Record<string, TagRow> = {}) => {
  state.fake = createFakeTagDb(map)
}
const itemTagInserts = () => state.fake.inserts.filter((i) => i.table === "item_tags").map((i) => (i.values as { tagId: string }).tagId)

describe("DataMergeService.merge のタグ関連付け (#68)", () => {
  it("他ユーザーの既存タグは関連付けず、エラーに追加する（アイテムは作成される）", async () => {
    setup({ "tag-foreign": { id: "tag-foreign", userId: "someone", groupId: null } })

    const res = await new DataMergeService().merge(ME, data({ items: [item(["tag-foreign"])] }))

    expect(itemTagInserts()).toEqual([])
    expect(res.mergedCounts.items).toBe(1)
    expect(res.errors.some((e) => e.includes("タグにアクセスできません"))).toBe(true)
    expect(res.success).toBe(false)
  })

  it("存在しないタグも関連付けずエラーに追加する", async () => {
    setup()

    const res = await new DataMergeService().merge(ME, data({ items: [item(["missing"])] }))

    expect(itemTagInserts()).toEqual([])
    expect(res.errors).toHaveLength(1)
  })

  it("自分の個人タグ(既存)は関連付けられる", async () => {
    setup({ "tag-mine": { id: "tag-mine", userId: ME, groupId: null } })

    const res = await new DataMergeService().merge(ME, data({ items: [item(["tag-mine"])] }))

    expect(itemTagInserts()).toEqual(["tag-mine"])
    expect(res.success).toBe(true)
  })

  it("マージ先グループと同じグループの既存タグは関連付けられる", async () => {
    setup({ "tag-g": { id: "tag-g", userId: "other-member", groupId: GROUP } })

    await new DataMergeService().merge(ME, data({ items: [item(["tag-g"])] }), GROUP)

    expect(itemTagInserts()).toEqual(["tag-g"])
  })

  it("マージ先グループと異なるグループのタグは関連付けない", async () => {
    setup({ "tag-x": { id: "tag-x", userId: ME, groupId: "other-group" } })

    await new DataMergeService().merge(ME, data({ items: [item(["tag-x"])] }), GROUP)

    expect(itemTagInserts()).toEqual([])
  })

  it("今回のマージで作成したタグは、DBを検索せず関連付けられる", async () => {
    setup()

    const res = await new DataMergeService().merge(
      ME,
      data({ tags: [{ id: "tag-new", name: "食品", createdAt: NOW }], items: [item(["tag-new"])] })
    )

    expect(itemTagInserts()).toEqual(["tag-new"])
    // 検索するのは、タグを作る前の「同じ名前の自分のタグ」の 1 回だけ。アイテムへの関連付けでは DB を検索しない
    expect(state.fake.selects).toEqual(["tags"])
    expect(res.success).toBe(true)
  })

  it("許可されたタグと拒否されたタグが混在しても、許可分だけ関連付ける", async () => {
    setup({
      "tag-mine": { id: "tag-mine", userId: ME, groupId: null },
      "tag-foreign": { id: "tag-foreign", userId: "someone", groupId: null },
    })

    const res = await new DataMergeService().merge(ME, data({ items: [item(["tag-foreign", "tag-mine"])] }))

    expect(itemTagInserts()).toEqual(["tag-mine"])
    expect(res.errors).toHaveLength(1)
  })
})
