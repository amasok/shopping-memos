import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  findInviteByToken: vi.fn(),
  isMember: vi.fn(),
  acceptInvite: vi.fn(),
  findById: vi.fn(),
}))

vi.mock("@/infrastructure/auth/server", () => ({ getAuth: vi.fn() }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({
  groupRepository: {
    findInviteByToken: state.findInviteByToken,
    isMember: state.isMember,
    acceptInvite: state.acceptInvite,
    findById: state.findById,
  },
}))

import { identityRouter } from "@/infrastructure/trpc/routers/identity"

const ME = "user-me"
const DAY = 24 * 60 * 60 * 1000
const caller = () => identityRouter.createCaller({ userId: ME })
const invite = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  groupId: "group-1",
  token: "t".repeat(32),
  expiresAt: new Date(Date.now() + DAY),
  usedAt: null,
  usedBy: null,
  ...over,
})
const accept = () => caller().acceptInvite({ token: "t".repeat(32) })

beforeEach(() => {
  state.findInviteByToken.mockReset().mockResolvedValue(invite())
  state.isMember.mockReset().mockResolvedValue(false)
  state.acceptInvite.mockReset().mockResolvedValue(true)
  state.findById.mockReset().mockResolvedValue({ id: "group-1", name: "家族" })
})

describe("identity.acceptInvite (#73-2)", () => {
  it("招待リンクの確保とメンバーの追加を、リポジトリの 1 つの処理で行う", async () => {
    await expect(accept()).resolves.toMatchObject({ id: "group-1" })
    expect(state.acceptInvite).toHaveBeenCalledWith(
      expect.objectContaining({ inviteId: "inv-1", groupId: "group-1", userId: ME })
    )
  })

  it("確認のあとに別のユーザーが先に使った（確保できなかった）ら、使用済みのエラーにする", async () => {
    state.acceptInvite.mockResolvedValue(false)

    await expect(accept()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "この招待リンクは既に使用されています",
    })
    expect(state.findById).not.toHaveBeenCalled()
  })

  it("同時に同じグループへ参加した（メンバーの一意制約）ときは、既にメンバーのエラーにする", async () => {
    state.acceptInvite.mockRejectedValue(
      Object.assign(new Error("Failed query"), { cause: { code: "23505", constraint_name: "group_members_group_user_idx" } })
    )

    await expect(accept()).rejects.toMatchObject({ code: "BAD_REQUEST", message: "既にこのグループのメンバーです" })
  })

  it("ほかのエラーはそのまま返す", async () => {
    state.acceptInvite.mockRejectedValue(new Error("connection lost"))

    await expect(accept()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" })
  })

  it("使用済み・期限切れ・既にメンバーは、確保する前に従来どおりのエラーにする", async () => {
    state.findInviteByToken.mockResolvedValueOnce(invite({ usedAt: new Date() }))
    await expect(accept()).rejects.toMatchObject({ message: "この招待リンクは既に使用されています" })

    state.findInviteByToken.mockResolvedValueOnce(invite({ expiresAt: new Date(Date.now() - 1) }))
    await expect(accept()).rejects.toMatchObject({ message: "招待リンクの有効期限が切れています" })

    state.isMember.mockResolvedValueOnce(true)
    await expect(accept()).rejects.toMatchObject({ message: "既にこのグループのメンバーです" })

    expect(state.acceptInvite).not.toHaveBeenCalled()
  })
})
