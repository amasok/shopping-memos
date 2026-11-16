// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { items, shoppingLists, tags } from "@/infrastructure/db/drizzle/schema"
import { canAccessScope, isSameScope, scopeCondition, type DbExecutor } from "../ownership"

const dialect = new PgDialect()
const render = (where: SQL) => dialect.sqlToQuery(where)

describe("isSameScope (#101)", () => {
  it("グループのデータ同士は、groupId が一致するときだけ同じ", () => {
    expect(isSameScope({ userId: "a", groupId: "g1" }, { userId: "b", groupId: "g1" })).toBe(true)
    expect(isSameScope({ userId: "a", groupId: "g1" }, { userId: "a", groupId: "g2" })).toBe(false)
  })

  it("グループと個人は、作成者が同じでも別", () => {
    expect(isSameScope({ userId: "a", groupId: "g1" }, { userId: "a", groupId: null })).toBe(false)
  })

  it("個人のデータ同士は、userId が一致するときだけ同じ", () => {
    expect(isSameScope({ userId: "a", groupId: null }, { userId: "a", groupId: null })).toBe(true)
    expect(isSameScope({ userId: "a", groupId: null }, { userId: "b", groupId: null })).toBe(false)
  })

  it("groupId の null と undefined は、どちらも「グループなし」", () => {
    expect(isSameScope({ userId: "a", groupId: undefined }, { userId: "a", groupId: null })).toBe(true)
  })

  it("所有者が分からない個人データは、どれとも一致しない（同じ null 同士でも）", () => {
    expect(isSameScope({ userId: null, groupId: null }, { userId: null, groupId: null })).toBe(false)
  })
})

describe("scopeCondition (#101)", () => {
  it.each([
    ["items", items],
    ["tags", tags],
    ["shopping_lists", shoppingLists],
  ] as const)("%s: グループのスコープはそのグループのデータに限定する", (name, table) => {
    const q = render(scopeCondition(table, { userId: "u1", groupId: "g1" }))
    expect(q.sql).toBe(`"${name}"."group_id" = $1`)
    expect(q.params).toEqual(["g1"])
  })

  it.each([
    ["items", items],
    ["tags", tags],
    ["shopping_lists", shoppingLists],
  ] as const)("%s: 個人のスコープは、グループなしで作成者が一致するデータに限定する", (name, table) => {
    const q = render(scopeCondition(table, { userId: "u1", groupId: undefined }))
    expect(q.sql).toBe(`("${name}"."group_id" is null and "${name}"."user_id" = $1)`)
    expect(q.params).toEqual(["u1"])
  })

  it("所有者が特定できないスコープは、何にも一致しない", () => {
    expect(render(scopeCondition(items, { userId: null, groupId: null })).sql).toBe("false")
  })
})

/** select().from().where().limit() を受け付け、results を返す疑似 executor。where の条件を記録する */
function executorReturning(results: unknown[]) {
  const wheres: SQL[] = []
  const executor = {
    select: () => ({
      from: () => ({
        where: (w: SQL) => {
          wheres.push(w)
          return { limit: async () => results }
        },
      }),
    }),
  } as unknown as DbExecutor
  return { executor, wheres }
}

describe("canAccessScope (#101)", () => {
  it("個人のデータは、作成者本人だけが使える（DB は見ない）", async () => {
    const { executor, wheres } = executorReturning([])
    expect(await canAccessScope(executor, { userId: "u1", groupId: null }, "u1")).toBe(true)
    expect(await canAccessScope(executor, { userId: "u1", groupId: undefined }, "u2")).toBe(false)
    expect(wheres).toHaveLength(0)
  })

  it("所有者が分からない個人データは、だれも使えない", async () => {
    const { executor } = executorReturning([])
    expect(await canAccessScope(executor, { userId: null, groupId: null }, "u1")).toBe(false)
  })

  it("グループのデータは、そのグループのメンバーだけが使える", async () => {
    const member = executorReturning([{ id: "m1" }])
    expect(await canAccessScope(member.executor, { userId: "owner", groupId: "g1" }, "u1")).toBe(true)
    const q = render(member.wheres[0])
    expect(q.params).toEqual(["g1", "u1"])

    const outsider = executorReturning([])
    expect(await canAccessScope(outsider.executor, { userId: "u1", groupId: "g1" }, "u1")).toBe(false)
  })
})
