import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  attempts: 1,
  group: null as null | {
    id: string
    name: string
    inviteCode: string
    inviteEnabled: boolean
    inviteCodeExpiresAt: Date
  },
  isMember: false,
  recordInviteCodeAttempt: vi.fn(),
  findByInviteCode: vi.fn(),
  isMemberFn: vi.fn(),
  addMember: vi.fn(),
}))

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({
  groupRepository: {
    recordInviteCodeAttempt: state.recordInviteCodeAttempt,
    findByInviteCode: state.findByInviteCode,
    isMember: state.isMemberFn,
    addMember: state.addMember,
  },
}))

import { identityRouter } from "@/infrastructure/trpc/routers/identity"

const ME = "user-me"
const DAY = 24 * 60 * 60 * 1000
const caller = () => identityRouter.createCaller({ userId: ME })
const makeGroup = (over: Partial<NonNullable<typeof state.group>> = {}) => ({
  id: "group-1",
  name: "家族",
  inviteCode: "ABCD2345",
  inviteEnabled: true,
  inviteCodeExpiresAt: new Date(Date.now() + DAY),
  ...over,
})

beforeEach(() => {
  state.attempts = 1
  state.group = makeGroup()
  state.isMember = false
  state.recordInviteCodeAttempt.mockReset().mockImplementation(async () => state.attempts)
  state.findByInviteCode.mockReset().mockImplementation(async () => state.group)
  state.isMemberFn.mockReset().mockImplementation(async () => state.isMember)
  state.addMember.mockReset().mockResolvedValue(undefined)
})

describe("identity.joinByInviteCode (#67)", () => {
  describe("有効期限", () => {
    it("期限切れのコードでは参加できず、addMember が呼ばれない", async () => {
      state.group = makeGroup({ inviteCodeExpiresAt: new Date(Date.now() - 1000) })

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("有効期限"),
      })
      expect(state.addMember).not.toHaveBeenCalled()
    })

    it("有効期限内のコードなら参加でき、メンバーとして追加される", async () => {
      const res = await caller().joinByInviteCode({ inviteCode: "ABCD2345" })

      expect(res.id).toBe("group-1")
      expect(state.addMember).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: "group-1", userId: ME, role: "member" })
      )
    })

    it("期限切れと既存メンバーが重なる場合は、期限切れを先に返す", async () => {
      state.group = makeGroup({ inviteCodeExpiresAt: new Date(Date.now() - 1000) })
      state.isMember = true

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).rejects.toMatchObject({
        message: expect.stringContaining("有効期限"),
      })
      expect(state.isMemberFn).not.toHaveBeenCalled()
    })
  })

  describe("試行回数の制限", () => {
    it("10回目までは受け付ける", async () => {
      state.attempts = 10

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).resolves.toBeDefined()
      expect(state.findByInviteCode).toHaveBeenCalled()
    })

    it("11回目は TOO_MANY_REQUESTS で、コードの検索も参加もしない", async () => {
      state.attempts = 11

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      })
      expect(state.findByInviteCode).not.toHaveBeenCalled()
      expect(state.addMember).not.toHaveBeenCalled()
    })

    it("正しいコードでも、上限を超えていれば拒否する", async () => {
      state.attempts = 50

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      })
      expect(state.addMember).not.toHaveBeenCalled()
    })

    it("ログインユーザーIDと1時間の窓で試行を記録する", async () => {
      await caller().joinByInviteCode({ inviteCode: "ABCD2345" })

      expect(state.recordInviteCodeAttempt).toHaveBeenCalledWith(ME, 60 * 60 * 1000)
    })

    it("コードが見つからない失敗でも試行を記録する", async () => {
      state.group = null

      await expect(caller().joinByInviteCode({ inviteCode: "ZZZZ2345" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      })
      expect(state.recordInviteCodeAttempt).toHaveBeenCalledTimes(1)
    })
  })

  describe("入力の検証と既存の判定", () => {
    it("5文字・9文字のコードは入力検証で拒否され、試行は記録されない", async () => {
      await expect(caller().joinByInviteCode({ inviteCode: "ABCDE" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      })
      await expect(caller().joinByInviteCode({ inviteCode: "ABCDEFGHJ" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      })
      expect(state.recordInviteCodeAttempt).not.toHaveBeenCalled()
    })

    it("旧形式の6文字のコードでも、有効期限内なら参加できる", async () => {
      state.group = makeGroup({ inviteCode: "ABC234" })

      await expect(caller().joinByInviteCode({ inviteCode: "ABC234" })).resolves.toBeDefined()
    })

    it("前後の空白は取り除いて検索する", async () => {
      await caller().joinByInviteCode({ inviteCode: "  ABCD2345  " })

      expect(state.findByInviteCode).toHaveBeenCalledWith("ABCD2345")
    })

    it("存在しないコードは BAD_REQUEST（無効・期限切れと同じエラー）", async () => {
      state.group = null

      await expect(caller().joinByInviteCode({ inviteCode: "ZZZZ2345" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      })
    })

    it("招待が無効化されているグループには参加できない", async () => {
      state.group = makeGroup({ inviteEnabled: false })

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("招待コードが無効"),
      })
      expect(state.addMember).not.toHaveBeenCalled()
    })

    it("既にメンバーなら参加できない", async () => {
      state.isMember = true

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("既に"),
      })
      expect(state.addMember).not.toHaveBeenCalled()
    })
  })

  describe("エラーの統一 (#107)", () => {
    /** joinByInviteCode を呼び、投げられたエラーの code と message を返す */
    const failure = async () => {
      try {
        await caller().joinByInviteCode({ inviteCode: "ABCD2345" })
      } catch (e) {
        const err = e as { code: string; message: string }
        return { code: err.code, message: err.message }
      }
      throw new Error("エラーが投げられなかった")
    }

    const setCase = (kind: "notFound" | "disabled" | "expired") => {
      state.group =
        kind === "notFound"
          ? null
          : kind === "disabled"
            ? makeGroup({ inviteEnabled: false })
            : makeGroup({ inviteCodeExpiresAt: new Date(Date.now() - 1000) })
    }

    it("見つからない・招待無効・期限切れは、codeもmessageも完全に同じ", async () => {
      setCase("notFound")
      const notFound = await failure()
      setCase("disabled")
      const disabled = await failure()
      setCase("expired")
      const expired = await failure()

      expect(notFound.code).toBe("BAD_REQUEST")
      expect(disabled).toEqual(notFound)
      expect(expired).toEqual(notFound)
    })

    it.each([["notFound"], ["disabled"], ["expired"]] as const)("%s のとき addMember も isMember も呼ばれない", async (kind) => {
      setCase(kind)

      await failure()

      expect(state.addMember).not.toHaveBeenCalled()
      expect(state.isMemberFn).not.toHaveBeenCalled()
    })

    it("統一メッセージはコードの存在・無効化・期限切れの内訳を示さず、有効期限切れの可能性には触れる", async () => {
      setCase("notFound")

      const { message } = await failure()

      expect(message).not.toContain("見つかりません")
      expect(message).not.toContain("受け付けていません")
      expect(message).toContain("無効")
      expect(message).toContain("有効期限")
    })

    it("既にメンバーの場合のエラーは、3ケースとは別の文言のまま", async () => {
      setCase("notFound")
      const unified = await failure()
      state.group = makeGroup()
      state.isMember = true

      const member = await failure()

      expect(member.code).toBe("BAD_REQUEST")
      expect(member.message).toContain("既に")
      expect(member.message).not.toBe(unified.message)
      expect(state.addMember).not.toHaveBeenCalled()
    })

    it("有効なコードなら統一エラーにならず参加できる", async () => {
      state.group = makeGroup()

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).resolves.toBeDefined()
      expect(state.addMember).toHaveBeenCalledTimes(1)
    })
  })
})
