import { describe, it, expect } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { catalogItemScopeCondition } from "../application/services/catalogItemScope"

const dialect = new PgDialect()
const toQuery = (scope: { userId: string | null; groupId: string | null }) =>
  dialect.sqlToQuery(catalogItemScopeCondition(scope))

describe("catalogItemScopeCondition", () => {
  it("グループリストではリストのgroupIdのアイテムに限定する", () => {
    const q = toQuery({ userId: "user-1", groupId: "group-1" })
    expect(q.sql).toContain('"items"."group_id" = $1')
    expect(q.sql).not.toContain("user_id")
    expect(q.params).toEqual(["group-1"])
  })

  it("個人リストではgroupIdなしかつ作成者のアイテムに限定する", () => {
    const q = toQuery({ userId: "user-1", groupId: null })
    expect(q.sql).toContain('"items"."group_id" is null')
    expect(q.sql).toContain('"items"."user_id" = $1')
    expect(q.params).toEqual(["user-1"])
  })

  it("所有者が特定できない個人リストでは何にも一致しない", () => {
    const q = toQuery({ userId: null, groupId: null })
    // 論理削除の条件（#62 O3b）と AND でつなぐが、false なので何にも一致しない
    expect(q.sql).toBe('(false and "items"."deleted_at" is null)')
    expect(q.params).toEqual([])
  })
})
