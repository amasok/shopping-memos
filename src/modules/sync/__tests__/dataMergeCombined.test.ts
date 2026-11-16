import { describe, it, expect, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getTableName, type SQL } from "drizzle-orm"

const dialect = new PgDialect()

const state = vi.hoisted(() => ({
  db: null as unknown,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
}))

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: new Proxy({}, { get: (_t, prop) => (state.db as never)[prop] }),
}))

import { DataMergeService } from "../application/services/DataMergeService"

const ME = "user-me"
const NOW = new Date("2026-01-01T00:00:00Z")

/** tags / shopping_lists の既存データを返し、INSERT を記録する transaction モック */
function setup(opts: {
  tags: Record<string, { id: string; userId: string | null; groupId: string | null }>
  lists: Record<string, { userId: string | null; groupId: string | null }>
}) {
  state.inserts = []
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: (where: SQL) => {
          const name = getTableName(table as Parameters<typeof getTableName>[0])
          const { params } = dialect.sqlToQuery(where)
          let rows: unknown[] = []
          if (name === "tags") rows = params.map((p) => opts.tags[String(p)]).filter(Boolean)
          if (name === "shopping_lists") rows = opts.lists[String(params[0])] ? [opts.lists[String(params[0])]] : []
          const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> }
          result.limit = () => Promise.resolve(rows)
          return result
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        state.inserts.push({ table: getTableName(table as Parameters<typeof getTableName>[0]), values })
      },
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => [{ id: "x" }] }) }),
    }),
  }
  state.db = { transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx) }
}

const inserted = (table: string) => state.inserts.filter((i) => i.table === table)

describe("DataMergeService.merge: タグ制限(#68)とリスト制限(#69)の併用", () => {
  it("他人のタグ・他人のリストが混在しても、それぞれ個別に拒否し、正当なデータだけをマージする", async () => {
    setup({
      tags: {
        "tag-foreign": { id: "tag-foreign", userId: "someone", groupId: null },
        "tag-mine": { id: "tag-mine", userId: ME, groupId: null },
      },
      lists: {
        "list-foreign": { userId: "someone", groupId: null },
        "list-mine": { userId: ME, groupId: null },
      },
    })

    const res = await new DataMergeService().merge(ME, {
      tags: [],
      items: [{ id: "item-1", name: "牛乳", quantity: 1, tagIds: ["tag-foreign", "tag-mine"], createdAt: NOW }],
      lists: [],
      listItems: [
        { id: "li-foreign", listId: "list-foreign", name: "他人宛", quantity: 1, tagIds: [], checked: false, createdAt: NOW },
        { id: "li-mine", listId: "list-mine", name: "自分宛", quantity: 1, tagIds: [], checked: false, createdAt: NOW },
      ],
      history: [],
    })

    // タグ: 自分のタグだけ関連付け
    expect(inserted("item_tags").map((i) => i.values.tagId)).toEqual(["tag-mine"])
    // リストアイテム: 自分のリスト宛だけ追加
    expect(inserted("list_items").map((i) => i.values.id)).toEqual(["li-mine"])
    // アイテム自体は作成される
    expect(res.mergedCounts.items).toBe(1)
    expect(res.mergedCounts.listItems).toBe(1)
    expect(res.success).toBe(false)
    expect(res.errors).toHaveLength(2)
    expect(res.errors.some((e) => e.includes("タグにアクセスできません"))).toBe(true)
    expect(res.errors.some((e) => e.includes("リストにアクセスできません"))).toBe(true)
  })

  it("今回作成したタグとリストは、DBの既存データを参照せずに両方使える", async () => {
    setup({ tags: {}, lists: {} })

    const res = await new DataMergeService().merge(ME, {
      tags: [{ id: "tag-new", name: "食品", createdAt: NOW }],
      items: [{ id: "item-1", name: "牛乳", quantity: 1, tagIds: ["tag-new"], createdAt: NOW }],
      lists: [{ id: "list-new", name: "新規", status: "in_progress", createdAt: NOW }],
      listItems: [{ id: "li-1", listId: "list-new", name: "牛乳", quantity: 1, tagIds: [], checked: false, createdAt: NOW }],
      history: [{ id: "h-1", listId: "list-new", purchasedAt: NOW }],
    })

    expect(inserted("item_tags")).toHaveLength(1)
    expect(inserted("list_items")).toHaveLength(1)
    expect(res.mergedCounts).toMatchObject({ tags: 1, items: 1, lists: 1, listItems: 1, history: 1 })
    expect(res.success).toBe(true)
  })
})
