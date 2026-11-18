import { describe, it, expect } from "vitest"
import { isSameScope } from "../ownerScope"

describe("isSameScope (#101・#179)", () => {
  it("グループのリストは同じグループの商品とだけ一致する", () => {
    const list = { userId: "u1", groupId: "gA" }
    expect(isSameScope({ userId: "u2", groupId: "gA" }, list)).toBe(true)
    expect(isSameScope({ userId: "u1", groupId: "gB" }, list)).toBe(false)
    expect(isSameScope({ userId: "u1", groupId: null }, list)).toBe(false)
  })

  it("個人のリストは作成者の個人の商品とだけ一致する", () => {
    const list = { userId: "u1", groupId: null }
    expect(isSameScope({ userId: "u1", groupId: null }, list)).toBe(true)
    expect(isSameScope({ userId: "u2", groupId: null }, list)).toBe(false)
    expect(isSameScope({ userId: "u1", groupId: "gA" }, list)).toBe(false)
  })

  it("所有者がわからない個人のリストはどの商品とも一致しない", () => {
    const list = { userId: null, groupId: null }
    expect(isSameScope({ userId: null, groupId: null }, list)).toBe(false)
    expect(isSameScope({ userId: "u1", groupId: null }, list)).toBe(false)
  })

  it("groupId の null と undefined は、どちらも「グループなし」", () => {
    expect(isSameScope({ userId: "a", groupId: undefined }, { userId: "a", groupId: null })).toBe(true)
  })
})
