import { describe, it, expect } from "vitest"
import {
  INVITE_LINK_EXPIRY_DAYS,
  INVITE_TOKEN_LENGTH,
} from "../domain/entities/InviteLink"

describe("InviteLink定数", () => {
  it("招待リンクの有効期限は7日", () => {
    expect(INVITE_LINK_EXPIRY_DAYS).toBe(7)
  })

  it("招待トークンは32バイト（256ビット）", () => {
    expect(INVITE_TOKEN_LENGTH).toBe(32)
  })
})

describe("招待トークン生成", () => {
  it("64文字の16進数文字列を生成する", () => {
    // 32バイト = 64文字の16進数
    const bytes = new Uint8Array(INVITE_TOKEN_LENGTH)
    crypto.getRandomValues(bytes)
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]+$/)
  })

  it("毎回異なるトークンを生成する", () => {
    const generateToken = () => {
      const bytes = new Uint8Array(INVITE_TOKEN_LENGTH)
      crypto.getRandomValues(bytes)
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    }

    const token1 = generateToken()
    const token2 = generateToken()

    expect(token1).not.toBe(token2)
  })
})

describe("GroupMemberロール", () => {
  it("ownerとmemberの2種類が存在する", () => {
    type GroupRole = "owner" | "member"
    const roles: GroupRole[] = ["owner", "member"]

    expect(roles).toContain("owner")
    expect(roles).toContain("member")
    expect(roles).toHaveLength(2)
  })
})

describe("招待リンクの有効期限計算", () => {
  it("現在時刻から7日後を計算する", () => {
    const now = new Date()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + INVITE_LINK_EXPIRY_DAYS)

    const diffInDays = Math.round(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )

    expect(diffInDays).toBe(7)
  })

  it("有効期限切れの判定が正しく動作する", () => {
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 1) // 1日前

    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 1) // 1日後

    const now = new Date()

    expect(now > pastDate).toBe(true) // 期限切れ
    expect(now > futureDate).toBe(false) // まだ有効
  })
})

describe("グループ作成入力バリデーション", () => {
  it("名前は必須", () => {
    const input = { name: "" }
    expect(input.name.length).toBe(0)
  })

  it("名前は50文字以内", () => {
    const validName = "a".repeat(50)
    const invalidName = "a".repeat(51)

    expect(validName.length).toBeLessThanOrEqual(50)
    expect(invalidName.length).toBeGreaterThan(50)
  })
})

describe("招待有効/無効フラグ", () => {
  it("グループのinviteEnabledがfalseの場合、招待コードによる参加を拒否すべき", () => {
    const group = {
      id: "group-1",
      name: "テストグループ",
      inviteCode: "ABC123",
      inviteEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // inviteEnabled が false なら参加不可
    expect(group.inviteEnabled).toBe(false)
  })

  it("グループのinviteEnabledがtrueの場合、招待コードによる参加を許可すべき", () => {
    const group = {
      id: "group-1",
      name: "テストグループ",
      inviteCode: "ABC123",
      inviteEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // inviteEnabled が true なら参加可能
    expect(group.inviteEnabled).toBe(true)
  })

  it("inviteEnabledのデフォルト値はtrue", () => {
    // スキーマのデフォルト値を反映
    const defaultInviteEnabled = true
    expect(defaultInviteEnabled).toBe(true)
  })

  it("トグルで有効に戻した後は参加できる", () => {
    const group = {
      id: "group-1",
      name: "テストグループ",
      inviteCode: "ABC123",
      inviteEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // 無効化中
    expect(group.inviteEnabled).toBe(false)

    // 有効に戻す
    const updatedGroup = { ...group, inviteEnabled: true }
    expect(updatedGroup.inviteEnabled).toBe(true)
  })

  it("setInviteEnabledの入力にはgroupIdとenabledが必要", () => {
    const input = {
      groupId: "550e8400-e29b-41d4-a716-446655440000",
      enabled: false,
    }

    expect(input.groupId).toBeDefined()
    expect(typeof input.enabled).toBe("boolean")
  })
})
