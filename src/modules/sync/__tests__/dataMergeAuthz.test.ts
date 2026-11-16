import { describe, it, expect, vi } from "vitest"
import { createFakeTx } from "./helpers/fakeTx"

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("./helpers/fakeTx").createFakeTx>,
}))

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: { transaction: (cb: never) => state.fake.db.transaction(cb) },
}))

import { DataMergeService, type MergeData } from "../application/services/DataMergeService"

const ME = "user-me"
const OTHER_LIST = "list-other"
const NOW = new Date("2026-01-01T00:00:00Z")

const empty = (): MergeData => ({ items: [], tags: [], lists: [], listItems: [], history: [] })
const listItem = (listId: string, id = "li-1") => ({
  id,
  listId,
  name: "牛乳",
  quantity: 1,
  tagIds: [],
  checked: false,
  createdAt: NOW,
})
const history = (listId: string) => ({ id: "h-1", listId, location: "店", purchasedAt: NOW })

const inserts = (table: string) => state.fake.writes.filter((w) => w.kind === "insert" && w.table === table)
const updates = () => state.fake.writes.filter((w) => w.kind === "update")

describe("DataMergeService.merge の認可 (#69)", () => {
  describe("listItems", () => {
    it("他人の個人リストへのリストアイテムは追加せずエラーにする", async () => {
      state.fake = createFakeTx({ lists: { [OTHER_LIST]: { userId: "someone", groupId: null } } })

      const res = await new DataMergeService().merge(ME, { ...empty(), listItems: [listItem(OTHER_LIST)] })

      expect(inserts("list_items")).toHaveLength(0)
      expect(inserts("sync_operations")).toHaveLength(0)
      expect(res.success).toBe(false)
      expect(res.mergedCounts.listItems).toBe(0)
      expect(res.errors[0]).toContain("リストにアクセスできません")
    })

    it("存在しないリストへのリストアイテムは追加しない", async () => {
      state.fake = createFakeTx()

      const res = await new DataMergeService().merge(ME, { ...empty(), listItems: [listItem("missing")] })

      expect(inserts("list_items")).toHaveLength(0)
      expect(res.errors).toHaveLength(1)
    })

    it("非メンバーのグループリストへは追加しない", async () => {
      state.fake = createFakeTx({ lists: { [OTHER_LIST]: { userId: "someone", groupId: "g1" } }, members: [] })

      await new DataMergeService().merge(ME, { ...empty(), listItems: [listItem(OTHER_LIST)] })

      expect(inserts("list_items")).toHaveLength(0)
    })

    it("自分の既存の個人リストには追加できる", async () => {
      state.fake = createFakeTx({ lists: { "list-mine": { userId: ME, groupId: null } } })

      const res = await new DataMergeService().merge(ME, { ...empty(), listItems: [listItem("list-mine")] })

      expect(inserts("list_items")).toHaveLength(1)
      expect(res.mergedCounts.listItems).toBe(1)
      expect(res.errors).toEqual([])
    })

    it("メンバーであるグループの既存リストには追加できる", async () => {
      state.fake = createFakeTx({
        lists: { "list-g": { userId: "someone", groupId: "g1" } },
        members: [`g1:${ME}`],
      })

      const res = await new DataMergeService().merge(ME, { ...empty(), listItems: [listItem("list-g")] })

      expect(inserts("list_items")).toHaveLength(1)
      expect(res.success).toBe(true)
    })

    it("今回のマージで作成したリストには追加できる", async () => {
      state.fake = createFakeTx()
      const data: MergeData = {
        ...empty(),
        lists: [{ id: "new-list", name: "新規", status: "in_progress", createdAt: NOW }],
        listItems: [listItem("new-list")],
      }

      const res = await new DataMergeService().merge(ME, data)

      expect(inserts("list_items")).toHaveLength(1)
      expect(res.success).toBe(true)
    })
  })

  describe("history", () => {
    it("他人のリストの履歴は更新せずエラーにする", async () => {
      state.fake = createFakeTx({ lists: { [OTHER_LIST]: { userId: "someone", groupId: null } } })

      const res = await new DataMergeService().merge(ME, { ...empty(), history: [history(OTHER_LIST)] })

      expect(updates()).toHaveLength(0)
      expect(res.mergedCounts.history).toBe(0)
      expect(res.success).toBe(false)
    })

    it("自分のリストの履歴は、作成者が自分のリストに限定した条件で更新する", async () => {
      state.fake = createFakeTx({ lists: { "list-mine": { userId: ME, groupId: null } } })

      const res = await new DataMergeService().merge(ME, { ...empty(), history: [history("list-mine")] })

      const [u] = updates()
      expect(u.table).toBe("shopping_lists")
      expect(u.sql).toContain('"shopping_lists"."user_id" = $2')
      expect(u.params).toEqual(["list-mine", ME])
      expect(res.mergedCounts.history).toBe(1)
      expect(res.success).toBe(true)
    })

    it("アクセス判定を通っても、更新対象が0件（他人作成のリスト）ならエラーにして同期ログを残さない", async () => {
      state.fake = createFakeTx({
        lists: { "list-g": { userId: "someone", groupId: "g1" } },
        members: [`g1:${ME}`],
        updateReturnsRows: 0,
      })

      const res = await new DataMergeService().merge(ME, { ...empty(), history: [history("list-g")] })

      expect(res.mergedCounts.history).toBe(0)
      expect(res.errors).toHaveLength(1)
      expect(inserts("sync_operations")).toHaveLength(0)
    })

    it("今回のマージで作成したリストの履歴は、IDのみの条件で更新できる", async () => {
      state.fake = createFakeTx()
      const data: MergeData = {
        ...empty(),
        lists: [{ id: "new-list", name: "新規", status: "completed", createdAt: NOW }],
        history: [history("new-list")],
      }

      const res = await new DataMergeService().merge(ME, data)

      const [u] = updates()
      expect(u.sql).not.toContain("user_id")
      expect(u.params).toEqual(["new-list"])
      expect(res.mergedCounts.history).toBe(1)
    })
  })
})
