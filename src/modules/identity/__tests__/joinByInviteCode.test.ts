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
        code: "NOT_FOUND",
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

    it("存在しないコードは NOT_FOUND", async () => {
      state.group = null

      await expect(caller().joinByInviteCode({ inviteCode: "ZZZZ2345" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      })
    })

    it("招待が無効化されているグループには参加できない", async () => {
      state.group = makeGroup({ inviteEnabled: false })

      await expect(caller().joinByInviteCode({ inviteCode: "ABCD2345" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("招待を受け付けていません"),
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
})
