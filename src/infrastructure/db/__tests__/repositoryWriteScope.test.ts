// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

/**
 * リポジトリの更新・削除の WHERE（#73-1・#62 O3b）
 *
 * 実際の動きは soft-delete.db.test.ts（実 DB）で確かめる。ここでは DB なしで、
 * WHERE に「操作したユーザーのスコープ」と「deleted_at IS NULL」が入ること、
 * 一致する行がなければ RowNotFoundError になることを確かめる
 */
const recorded = vi.hoisted(() => ({ wheres: [] as unknown[] }))

vi.mock("@/infrastructure/db/drizzle/client", () => {
  // どのメソッドを呼んでも自分を返し、await すると空の結果になるクエリビルダー
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (rows: unknown[]) => unknown) => resolve([])
        if (prop === "where") {
          return (where: unknown) => {
            recorded.wheres.push(where)
            return chain
          }
        }
        if (prop === "transaction") return (cb: (tx: unknown) => unknown) => cb(chain)
        return () => chain
      },
    }
  )
  return { db: chain }
})

import { RowNotFoundError } from "../errors"
import { itemRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleItemRepository"
import { tagRepository } from "@/modules/catalog/infrastructure/repositories/DrizzleTagRepository"
import { shoppingListRepository } from "@/modules/shopping/infrastructure/repositories/DrizzleShoppingListRepository"

const dialect = new PgDialect()
// 最後の WHERE が更新・削除のもの（リストのアイテムでは、先に親のリストのサブクエリの WHERE が作られる）
const lastWhere = () => dialect.sqlToQuery(recorded.wheres[recorded.wheres.length - 1] as SQL)

beforeEach(() => {
  recorded.wheres = []
})

const ACTOR = "actor-1"

const cases: Array<[string, string, () => Promise<unknown>]> = [
  ["アイテムの更新", "items", () => itemRepository.update({ id: "i1", name: "x" }, ACTOR)],
  ["アイテムの削除", "items", () => itemRepository.delete("i1", ACTOR)],
  ["アイテムを購入済みに", "items", () => itemRepository.markAsPurchased("i1", ACTOR)],
  ["アイテムを未購入に", "items", () => itemRepository.markAsUnpurchased("i1", ACTOR)],
  ["タグの更新", "tags", () => tagRepository.update({ id: "t1", name: "x" }, ACTOR)],
  ["タグの削除", "tags", () => tagRepository.delete("t1", ACTOR)],
  ["リストの更新", "shopping_lists", () => shoppingListRepository.update({ id: "l1", name: "x" }, ACTOR)],
  ["リストの削除", "shopping_lists", () => shoppingListRepository.delete("l1", ACTOR)],
  ["リストを購入済みに", "shopping_lists", () => shoppingListRepository.markAsPurchased("l1", ACTOR)],
  ["リストを未購入に", "shopping_lists", () => shoppingListRepository.markAsUnpurchased("l1", ACTOR)],
]

// リストのアイテムは親のリストのサブクエリで判定する（モックのサブクエリは SQL にできないので、別に確かめる）
const listItemCases: Array<[string, () => Promise<unknown>]> = [
  ["リストのアイテムのチェック", () => shoppingListRepository.updateItem({ id: "li1", checked: true }, ACTOR)],
  ["リストのアイテムを外す", () => shoppingListRepository.removeItem("li1", ACTOR)],
]

describe("リポジトリの更新・削除のスコープ", () => {
  it.each(cases)("%s: 一致する行がなければ RowNotFoundError", async (_name, _table, run) => {
    await expect(run()).rejects.toBeInstanceOf(RowNotFoundError)
  })

  it.each(listItemCases)("%s: 一致する行がなければ RowNotFoundError", async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(RowNotFoundError)
  })

  it.each(cases)("%s: WHERE に deleted_at IS NULL と操作したユーザーのスコープが入る", async (_name, table, run) => {
    await run().catch(() => {})
    const q = lastWhere()
    expect(q.sql).toContain(`"${table}"."deleted_at" is null`)
    expect(q.sql).toContain('"group_members"."user_id"')
    expect(q.params).toContain(ACTOR)
  })

  it.each(listItemCases)("%s: 親のリストは、削除されていない・操作したユーザーが使えるものに限る", async (_name, run) => {
    await run().catch(() => {})
    // 先に作られる WHERE が親のリストのサブクエリ
    const q = dialect.sqlToQuery(recorded.wheres[0] as SQL)
    expect(q.sql).toContain('"shopping_lists"."deleted_at" is null')
    expect(q.sql).toContain('"group_members"."user_id"')
    expect(q.params).toContain(ACTOR)
  })

  it("取得系は削除済みを返さない（findById の WHERE に deleted_at IS NULL）", async () => {
    expect(await itemRepository.findById("i1")).toBeNull()
    expect(await tagRepository.findById("t1")).toBeNull()
    expect(await shoppingListRepository.findById("l1")).toBeNull()
    expect(await shoppingListRepository.findItemById("li1")).toBeNull()
    const sqls = recorded.wheres.map((w) => dialect.sqlToQuery(w as SQL).sql)
    expect(sqls[0]).toContain('"items"."deleted_at" is null')
    expect(sqls[1]).toContain('"tags"."deleted_at" is null')
    expect(sqls[2]).toContain('"shopping_lists"."deleted_at" is null')
    expect(sqls[3]).toContain('"list_items"."deleted_at" is null')
  })
})
