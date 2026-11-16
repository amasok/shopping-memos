import { describe, it, expect } from "vitest"
import {
  createGroupSchema,
  inviteMemberSchema,
  acceptInviteSchema,
  groupRoleSchema,
  setInviteEnabledSchema,
  joinByInviteCodeSchema,
} from "../group"

describe("createGroupSchema", () => {
  it("有効な入力を受け入れる", () => {
    const input = { name: "家族" }

    const result = createGroupSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("家族")
    }
  })

  it("空の名前を拒否する", () => {
    const input = { name: "" }

    const result = createGroupSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("50文字を超える名前を拒否する", () => {
    const input = { name: "a".repeat(51) }

    const result = createGroupSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("inviteMemberSchema", () => {
  it("有効なgroupIdを受け入れる", () => {
    const input = { groupId: "550e8400-e29b-41d4-a716-446655440000" }

    const result = inviteMemberSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("無効なUUIDを拒否する", () => {
    const input = { groupId: "invalid" }

    const result = inviteMemberSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("acceptInviteSchema", () => {
  it("有効なトークンを受け入れる", () => {
    const input = { token: "abc123xyz" }

    const result = acceptInviteSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("空のトークンを拒否する", () => {
    const input = { token: "" }

    const result = acceptInviteSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("setInviteEnabledSchema", () => {
  it("有効な入力を受け入れる", () => {
    const input = { groupId: "550e8400-e29b-41d4-a716-446655440000", enabled: true }

    const result = setInviteEnabledSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.groupId).toBe("550e8400-e29b-41d4-a716-446655440000")
      expect(result.data.enabled).toBe(true)
    }
  })

  it("enabled=falseを受け入れる", () => {
    const input = { groupId: "550e8400-e29b-41d4-a716-446655440000", enabled: false }

    const result = setInviteEnabledSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(false)
    }
  })

  it("無効なUUIDを拒否する", () => {
    const input = { groupId: "invalid", enabled: true }

    const result = setInviteEnabledSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("enabledがboolean以外の場合を拒否する", () => {
    const input = { groupId: "550e8400-e29b-41d4-a716-446655440000", enabled: "yes" }

    const result = setInviteEnabledSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("enabledが欠落している場合を拒否する", () => {
    const input = { groupId: "550e8400-e29b-41d4-a716-446655440000" }

    const result = setInviteEnabledSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("groupRoleSchema", () => {
  it("ownerを受け入れる", () => {
    const result = groupRoleSchema.safeParse("owner")

    expect(result.success).toBe(true)
  })

  it("memberを受け入れる", () => {
    const result = groupRoleSchema.safeParse("member")

    expect(result.success).toBe(true)
  })

  it("無効な役割を拒否する", () => {
    const result = groupRoleSchema.safeParse("admin")

    expect(result.success).toBe(false)
  })
})

describe("joinByInviteCodeSchema (#67)", () => {
  it.each([["ABC234"], ["ABCD2345"], ["ABCDEFG"]])("%s（6〜8文字）を受け入れる", (inviteCode) => {
    expect(joinByInviteCodeSchema.safeParse({ inviteCode }).success).toBe(true)
  })

  it("5文字を拒否する", () => {
    expect(joinByInviteCodeSchema.safeParse({ inviteCode: "ABCDE" }).success).toBe(false)
  })

  it("9文字を拒否する", () => {
    expect(joinByInviteCodeSchema.safeParse({ inviteCode: "ABCDEFGHJ" }).success).toBe(false)
  })

  it("空文字を拒否する", () => {
    expect(joinByInviteCodeSchema.safeParse({ inviteCode: "" }).success).toBe(false)
  })

  it("前後の空白を取り除いてから長さを判定する", () => {
    const ok = joinByInviteCodeSchema.safeParse({ inviteCode: "  ABCD2345  " })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.inviteCode).toBe("ABCD2345")

    // 空白を含めて9文字でも、trim 後が8文字なら受け入れる
    expect(joinByInviteCodeSchema.safeParse({ inviteCode: " ABCD2345" }).success).toBe(true)
    // trim 後が5文字なら拒否する
    expect(joinByInviteCodeSchema.safeParse({ inviteCode: "  ABCDE  " }).success).toBe(false)
  })
})
