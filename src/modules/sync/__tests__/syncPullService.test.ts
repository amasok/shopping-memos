// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getTableName } from "drizzle-orm"

/**
 * SyncPullService のカーソルとページングの判定（#62 O5）を、DB なしで確かめるユニットテスト
 *
 * 実際の SQL（スコープ・さかのぼり・(updated_at, id) の比較）は sync-pull.db.test.ts（実 DB）で確かめる。
 * ここでは WHERE を見ずに limit だけを守るメモリ上の DB で、ページの分け方とカーソルの状態を確かめる
 */
const state = vi.hoisted(() => ({
  rows: {} as Record<string, Array<{ row: Record<string, unknown>; at: string }>>,
  fetched: [] as string[],
  links: [] as Array<{ itemId: string; tagId: string }>,
}))

vi.mock("@/infrastructure/db/drizzle/client", () => {
  const query = (tableName: string) => {
    let limit = Infinity
    const chain = {
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        limit = n
        return chain
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (tableName === "group_members") return resolve([{ groupId: "g1" }])
        if (tableName === "item_tags") return resolve(state.links)
        state.fetched.push(tableName)
        return resolve((state.rows[tableName] ?? []).slice(0, limit).map((r) => ({ ...r, parentDeletedAt: null })))
      },
    }
    return chain
  }
  const tx = {
    select: () => ({ from: (t: unknown) => query(getTableName(t as Parameters<typeof getTableName>[0])) }),
    execute: async () => [{ now: new Date("2026-06-01T00:00:00.000Z") }],
  }
  return { db: { transaction: async (cb: (t: unknown) => unknown) => cb(tx) } }
})

import {
  InvalidCursorError,
  PULL_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  syncPullService,
} from "../application/services/SyncPullService"

const rowsOf = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ row: { id: `${prefix}-${i}` }, at: `2026-01-01 00:00:00.${String(i).padStart(6, "0")}` }))

beforeEach(() => {
  state.rows = {}
  state.fetched = []
  state.links = []
})

describe("カーソルの文字列", () => {
  it("省略すると、すべてのエンティティが最初から", () => {
    expect(decodeCursor(undefined)).toEqual({ v: 1, pos: { tags: null, items: null, lists: null, listItems: null } })
  })

  it("エンコードしたものを、そのままデコードできる", () => {
    const cursor = {
      v: 1 as const,
      pos: { tags: { at: "2026-01-01 00:00:00.123456", id: "t", started: false }, items: null, lists: null, listItems: null },
    }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it("形は合っていても時刻として正しくない値・マイクロ秒の 6 桁がない値は InvalidCursorError（DB のエラーにしない）", () => {
    const withAt = (at: string) =>
      Buffer.from(JSON.stringify({ v: 1, pos: { tags: { at, id: "x", started: true }, items: null, lists: null, listItems: null } })).toString(
        "base64url"
      )
    expect(() => decodeCursor(withAt("2026-13-45 99:99:99.000000"))).toThrow(InvalidCursorError)
    expect(() => decodeCursor(withAt("2026-02-30 00:00:00.000000"))).toThrow(InvalidCursorError)
    expect(() => decodeCursor(withAt("2026-01-01 00:00:00"))).toThrow(InvalidCursorError)
    expect(decodeCursor(withAt("2026-02-28 23:59:59.999999")).pos.tags?.at).toBe("2026-02-28 23:59:59.999999")
  })

  it("形が壊れている・時刻の形でない・バージョンが違うカーソルは InvalidCursorError", () => {
    const bad = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
    expect(() => decodeCursor("%%%")).toThrow(InvalidCursorError)
    expect(() => decodeCursor(bad({ v: 2, pos: {} }))).toThrow(InvalidCursorError)
    expect(() =>
      decodeCursor(bad({ v: 1, pos: { tags: { at: "1 OR 1=1", id: "x", started: true }, items: null, lists: null, listItems: null } }))
    ).toThrow(InvalidCursorError)
  })
})

describe("SyncPullService のページング", () => {
  it("すべて入るときは hasMore なしで、次の pull はさかのぼって始めるカーソルを返す", async () => {
    state.rows = { tags: rowsOf(2, "t"), items: rowsOf(1, "i"), shopping_lists: [], list_items: [] }
    state.links = [{ itemId: "i-0", tagId: "t-1" }]
    const out = await syncPullService.pull("u1", undefined)
    expect(out).toMatchObject({ hasMore: false, memberships: { groupIds: ["g1"] }, serverTime: "2026-06-01T00:00:00.000Z" })
    expect(out.changes.tags.map((t) => t.id)).toEqual(["t-0", "t-1"])
    expect(out.changes.items).toEqual([{ id: "i-0", tagIds: ["t-1"] }])
    expect(decodeCursor(out.nextCursor).pos).toEqual({
      tags: { at: "2026-01-01 00:00:00.000001", id: "t-1", started: false },
      items: { at: "2026-01-01 00:00:00.000000", id: "i-0", started: false },
      lists: null,
      listItems: null,
    })
  })

  it("ページが埋まったら hasMore で、取れなかったエンティティは取らずに位置を残す", async () => {
    state.rows = { tags: rowsOf(PULL_PAGE_SIZE + 1, "t"), items: rowsOf(1, "i") }
    const start = encodeCursor({
      v: 1,
      pos: { tags: null, items: { at: "2025-12-31 00:00:00.000000", id: "old", started: false }, lists: null, listItems: null },
    })
    const out = await syncPullService.pull("u1", start)
    expect(out.hasMore).toBe(true)
    expect(out.changes.tags).toHaveLength(PULL_PAGE_SIZE)
    expect(state.fetched).toEqual(["tags"])
    const pos = decodeCursor(out.nextCursor).pos
    // 続きのページではさかのぼらない
    expect(pos.tags).toMatchObject({ id: `t-${PULL_PAGE_SIZE - 1}`, started: true })
    // 取れなかったエンティティは、次のページでさかのぼって取る
    expect(pos.items).toEqual({ at: "2025-12-31 00:00:00.000000", id: "old", started: false })
  })

  it("行がなかったエンティティは、位置を変えずにさかのぼり済みにする（続きのページ）", async () => {
    // タグは行がなく、アイテムでページが埋まる（hasMore）
    state.rows = { tags: [], items: rowsOf(PULL_PAGE_SIZE + 1, "i") }
    const start = encodeCursor({
      v: 1,
      pos: { tags: { at: "2025-12-31 00:00:00.000000", id: "x", started: false }, items: null, lists: null, listItems: null },
    })
    const out = await syncPullService.pull("u1", start)
    expect(out.hasMore).toBe(true)
    expect(decodeCursor(out.nextCursor).pos.tags).toEqual({ at: "2025-12-31 00:00:00.000000", id: "x", started: true })
  })
})
