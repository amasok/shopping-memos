// @vitest-environment node
import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { items } from "../drizzle/schema"
import {
  SERVER_NOW_ISO,
  fieldNotNewerThan,
  createdFieldTimes,
  definedFields,
  notDeleted,
  softDeleteValues,
  touchFields,
} from "../syncColumns"

const dialect = new PgDialect()
const toQuery = (sql: SQL) => dialect.sqlToQuery(sql)

describe("同期用の列の書き込み（#62 O3b）", () => {
  it("サーバー時刻は DB の now() を UTC・ミリ秒の ISO 文字列にしたもの", () => {
    expect(toQuery(SERVER_NOW_ISO).sql).toBe(
      `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
    )
  })

  it("notDeleted は deleted_at IS NULL の条件", () => {
    expect(toQuery(notDeleted(items)).sql).toBe('"items"."deleted_at" is null')
  })

  it("touchFields は updated_at を now() にし、書き込んだフィールドのキーだけをサーバー時刻で上書きする", () => {
    const values = touchFields(items, ["name", "memo"])
    expect(toQuery(values.updatedAt).sql).toBe("now()")
    const q = toQuery(values.fieldModifiedAt)
    expect(q.sql).toContain('"items"."field_modified_at" || jsonb_build_object($1::text, to_char(now()')
    expect(q.sql).toContain("$2::text")
    expect(q.params).toEqual(["name", "memo"])
  })

  it("touchFields は書き込んだフィールドがなければ field_modified_at をそのままにする", () => {
    const q = toQuery(touchFields(items, []).fieldModifiedAt)
    expect(q.sql).toBe('"items"."field_modified_at"')
    expect(q.params).toEqual([])
  })

  it("createdFieldTimes はすべてのフィールドのキーを持つ jsonb を作る", () => {
    const q = toQuery(createdFieldTimes(["name", "quantity"]))
    expect(q.sql.startsWith("jsonb_build_object($1::text, to_char(now()")).toBe(true)
    expect(q.params).toEqual(["name", "quantity"])
  })

  it("softDeleteValues は deleted_at と updated_at を now() にする", () => {
    const values = softDeleteValues()
    expect(toQuery(values.deletedAt).sql).toBe("now()")
    expect(toQuery(values.updatedAt).sql).toBe("now()")
  })

  it("definedFields は undefined でないフィールドだけを返す（null は書き込みとして数える）", () => {
    const input = { id: "1", name: "x", quantity: undefined, memo: null as string | null }
    expect(definedFields(input, ["name", "quantity", "memo"])).toEqual(["name", "memo"])
  })

  it("touchFields に時刻を渡すと、キーをその時刻にする（複合操作の操作の時刻。#62 O4b）", () => {
    const q = toQuery(touchFields(items, ["purchasedAt"], "2026-01-02T00:00:00.000Z").fieldModifiedAt)
    expect(q.sql).toBe('"items"."field_modified_at" || jsonb_build_object($1::text, $2::text)')
    expect(q.params).toEqual(["purchasedAt", "2026-01-02T00:00:00.000Z"])
  })

  it("fieldNotNewerThan は、キーがないか、時刻が指定以前のときだけ真になる条件", () => {
    const q = toQuery(fieldNotNewerThan(items, "purchasedAt", "2026-01-02T00:00:00.000Z"))
    expect(q.sql).toBe(`coalesce("items"."field_modified_at" ->> $1::text, '') <= $2::text`)
    expect(q.params).toEqual(["purchasedAt", "2026-01-02T00:00:00.000Z"])
  })
})
