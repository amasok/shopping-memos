import { describe, it, expect } from "vitest"
import { isUniqueViolation } from "../errors"

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
