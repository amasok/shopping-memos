import { describe, it, expect } from "vitest"
import {
  DuplicateIdError,
  RowNotFoundError,
  describeDbError,
  formatDbErrorKind,
  isUniqueViolation,
  rethrowDuplicateId,
} from "../errors"

const pgError = (extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", ...extra })

describe("isUniqueViolation", () => {
  it("PostgreSQL の一意制約違反（23505）を見分ける", () => {
    expect(isUniqueViolation(pgError())).toBe(true)
  })

  it("drizzle が包んだエラー（cause に元のエラー）も見分ける", () => {
    const wrapped = Object.assign(new Error("Failed query: insert ..."), { cause: pgError() })
    expect(isUniqueViolation(wrapped)).toBe(true)
  })

  it("hint を渡すと、制約名か詳細にそれを含むものだけを対象にする", () => {
    const inviteCode = pgError({ constraint_name: "groups_invite_code_unique" })
    const member = pgError({ constraint_name: "group_members_group_user_idx" })
    expect(isUniqueViolation(inviteCode, "invite_code")).toBe(true)
    expect(isUniqueViolation(member, "invite_code")).toBe(false)
    expect(isUniqueViolation(pgError({ detail: "Key (invite_code)=(ABC) already exists." }), "invite_code")).toBe(true)
  })

  it("ほかのエラーは一意制約違反としない", () => {
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false)
    expect(isUniqueViolation(new Error("connection lost"))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation("23505")).toBe(false)
  })
})

describe("describeDbError / formatDbErrorKind", () => {
  it("drizzle が包んだ PG のエラーから、code・制約名・テーブル名だけを取り出す", () => {
    const wrapped = Object.assign(new Error("Failed query: insert ... params: user-1"), {
      cause: Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: "tags_pkey",
        table_name: "tags",
        detail: "Key (id)=(abc) already exists.",
      }),
    })
    const kind = describeDbError(wrapped)
    expect(kind).toEqual({ code: "23505", constraint: "tags_pkey", table: "tags" })
    const line = formatDbErrorKind(kind)
    expect(line).toBe("code=23505 constraint=tags_pkey table=tags")
    expect(line).not.toContain("abc")
    expect(line).not.toContain("user-1")
  })

  it("DB のエラーでなければ code=unknown", () => {
    expect(describeDbError(new Error("boom"))).toEqual({})
    expect(formatDbErrorKind(describeDbError(null))).toBe("code=unknown")
  })

  it("制約名がないエラーは code だけを出す", () => {
    expect(formatDbErrorKind(describeDbError({ code: "40001" }))).toBe("code=40001")
  })
})

describe("rethrowDuplicateId（#62 O3b）", () => {
  it("主キーの一意制約違反は DuplicateIdError にする", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: pgError({ constraint_name: "items_pkey" }) })
    expect(() => rethrowDuplicateId(wrapped, "items", "アイテム")).toThrow(DuplicateIdError)
  })

  it("主キー以外の一意制約違反や、ほかのエラーはそのまま投げる", () => {
    const other = pgError({ constraint_name: "groups_invite_code_unique" })
    expect(() => rethrowDuplicateId(other, "items", "アイテム")).toThrow(other)
    const plain = new Error("connection refused")
    expect(() => rethrowDuplicateId(plain, "items", "アイテム")).toThrow(plain)
  })

  it("RowNotFoundError のメッセージに対象の名前が入る", () => {
    expect(new RowNotFoundError("アイテム").message).toBe("アイテムが見つかりません")
  })
})
