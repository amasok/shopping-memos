import { describe, it, expect, vi } from "vitest"
import { getTableName } from "drizzle-orm"

/**
 * #90: PostgreSQL では、トランザクション内で 1 文が失敗すると、ROLLBACK TO SAVEPOINT するまで
 * 以降の文がすべて "current transaction is aborted" で失敗する。その挙動を再現するモックで、
 * 重複 ID が 1 件あっても、ほかのデータはマージされることを確かめる。
 */

const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock("@/infrastructure/db/drizzle/client", () => ({
  db: new Proxy({}, { get: (_t, prop) => (state.db as never)[prop] }),
}))

import { DataMergeService, type MergeData } from "../application/services/DataMergeService"

type Row = { table: string; id?: string; values: Record<string, unknown> }

/** 重複 ID の INSERT が失敗し、SAVEPOINT で囲まなければ以降の文が全部失敗する疑似 DB */
function createPgLikeDb(existing: Array<{ table: string; id: string }>) {
  const committed: Row[] = []
  const exists = (rows: Array<{ table: string; id?: string }>, table: string, id?: string) =>
    id !== undefined && rows.some((r) => r.table === table && r.id === id)

  const makeScope = (pending: Row[]) => {
    const scope = { aborted: false }
    const guard = () => {
      if (scope.aborted) {
        throw new Error("current transaction is aborted, commands ignored until end of transaction block")
      }
    }
    const api = {
      select: () => ({
        from: () => ({
          where: () => {
            guard()
            const result = Promise.resolve<unknown[]>([]) as Promise<unknown[]> & { limit: () => Promise<unknown[]> }
            result.limit = () => Promise.resolve([])
            return result
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          guard()
          const name = getTableName(table as Parameters<typeof getTableName>[0])
          const id = typeof values.id === "string" ? values.id : undefined
          if (
            name !== "sync_operations" &&
            name !== "item_tags" &&
            (exists(existing, name, id) || exists(committed, name, id) || exists(pending, name, id))
          ) {
            scope.aborted = true
            throw new Error(`duplicate key value violates unique constraint (${name}.${id})`)
          }
          pending.push({ table: name, id, values })
        },
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              guard()
              return [{ id: "x" }]
            },
          }),
        }),
      }),
      transaction: async (cb: (t: unknown) => Promise<void>) => {
        guard()
        const sub: Row[] = []
        const child = makeScope(sub)
        // 成功なら RELEASE SAVEPOINT、失敗なら ROLLBACK TO SAVEPOINT（sub を捨て、親の状態は壊さない）
        await cb(child.api)
        pending.push(...sub)
      },
    }
    return { api, scope }
  }

  const db = {
    transaction: async (cb: (t: unknown) => Promise<void>) => {
      const pending: Row[] = []
      const { api, scope } = makeScope(pending)
      await cb(api)
      if (scope.aborted) {
        // 失敗した文が SAVEPOINT で囲まれていなければ COMMIT も失敗する
        throw new Error("commit failed: transaction is aborted")
      }
      committed.push(...pending)
    },
  }
  return { db, committed }
}

const NOW = new Date("2026-01-01T00:00:00Z")
const emptyData: MergeData = { items: [], tags: [], lists: [], listItems: [], history: [] }

const tag = (id: string, name: string) => ({ id, name, createdAt: NOW })
const item = (id: string, name: string, tagIds: string[] = []) => ({
  id,
  name,
  quantity: 1,
  tagIds,
  createdAt: NOW,
})

describe("DataMergeService.merge: 1 件の失敗が全体を壊さない (#90)", () => {
  it("重複 ID のタグが 1 件あっても、ほかのタグ・アイテムはマージされ、重複した分だけが errors になる", async () => {
    const fake = createPgLikeDb([{ table: "tags", id: "tag-dup" }])
    state.db = fake.db

    const result = await new DataMergeService().merge("user-me", {
      ...emptyData,
      tags: [tag("tag-dup", "重複"), tag("tag-new", "新規")],
      items: [item("item-1", "牛乳")],
    })

    expect(result.mergedCounts).toMatchObject({ tags: 1, items: 1 })
    expect(result.errors).toEqual(['タグ "重複" のマージに失敗'])
    expect(result.success).toBe(false)
    const ids = fake.committed.filter((r) => r.table === "tags").map((r) => r.id)
    expect(ids).toEqual(["tag-new"])
    expect(fake.committed.some((r) => r.table === "items" && r.id === "item-1")).toBe(true)
  })

  it("重複したアイテムが 1 件あっても、後続のアイテム・リスト・リストアイテムがマージされる", async () => {
    const fake = createPgLikeDb([{ table: "items", id: "item-dup" }])
    state.db = fake.db

    const result = await new DataMergeService().merge("user-me", {
      ...emptyData,
      items: [item("item-dup", "重複"), item("item-ok", "パン")],
      lists: [{ id: "list-1", name: "リスト", status: "in_progress", createdAt: NOW }],
      listItems: [
        { id: "li-1", listId: "list-1", name: "パン", quantity: 1, tagIds: [], checked: false, createdAt: NOW },
      ],
    })

    expect(result.mergedCounts).toMatchObject({ items: 1, lists: 1, listItems: 1 })
    expect(result.errors).toEqual(['アイテム "重複" のマージに失敗'])
    expect(result.errors.some((e) => e.startsWith("マージ処理に失敗しました"))).toBe(false)
  })

  it("失敗したアイテムの同期ログ・タグ関連は残らない（その分だけロールバックされる）", async () => {
    const fake = createPgLikeDb([{ table: "items", id: "item-dup" }])
    state.db = fake.db

    await new DataMergeService().merge("user-me", {
      ...emptyData,
      items: [item("item-dup", "重複")],
    })

    expect(fake.committed.filter((r) => r.table === "sync_operations")).toHaveLength(0)
  })

  it("重複したリストは、そのリストを後続の履歴・リストアイテムの許可対象にしない", async () => {
    const fake = createPgLikeDb([{ table: "shopping_lists", id: "list-dup" }])
    state.db = fake.db

    const result = await new DataMergeService().merge("user-me", {
      ...emptyData,
      lists: [{ id: "list-dup", name: "重複", status: "in_progress", createdAt: NOW }],
      listItems: [
        { id: "li-1", listId: "list-dup", name: "x", quantity: 1, tagIds: [], checked: false, createdAt: NOW },
      ],
    })

    expect(result.mergedCounts.lists).toBe(0)
    expect(result.mergedCounts.listItems).toBe(0)
  })

  it("全件が成功するときは success: true でエラーなし", async () => {
    const fake = createPgLikeDb([])
    state.db = fake.db

    const result = await new DataMergeService().merge("user-me", {
      ...emptyData,
      tags: [tag("t1", "食品")],
      items: [item("i1", "牛乳", ["t1"])],
    })

    expect(result).toMatchObject({
      success: true,
      errors: [],
      mergedCounts: { tags: 1, items: 1 },
    })
  })
})
