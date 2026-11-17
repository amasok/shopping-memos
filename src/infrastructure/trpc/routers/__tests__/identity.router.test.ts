// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const repo = vi.hoisted(() => ({
  findByUserId: vi.fn(), createWithOwner: vi.fn(), isOwner: vi.fn(), isMember: vi.fn(), update: vi.fn(),
  delete: vi.fn(), findById: vi.fn(), regenerateInviteCode: vi.fn(), setInviteEnabled: vi.fn(),
  findMembers: vi.fn(), createInvite: vi.fn(), findInviteByToken: vi.fn(), acceptInvite: vi.fn(),
  recordInviteCodeAttempt: vi.fn(), findByInviteCode: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(),
}))
vi.mock("@/infrastructure/auth/server", () => ({ getAuth: vi.fn() }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({ groupRepository: repo }))

import { identityRouter } from "../identity"
import { INVITE_CODE_MAX_ATTEMPTS } from "@/modules/identity/domain/entities/InviteCode"

const G = "22222222-2222-4222-8222-222222222222"
const U = "11111111-1111-4111-8111-111111111111"
const me = "user-1"
const caller = () => identityRouter.createCaller({ userId: me } as never)
const day = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.resetAllMocks()
})

describe("identity: 認証", () => {
  it("ログインしていないと UNAUTHORIZED", async () => {
    await expect(identityRouter.createCaller({} as never).getGroups()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })
})

describe("identity: グループ", () => {
  it("getGroups は自分のグループを返す", async () => {
    repo.findByUserId.mockResolvedValue([{ id: G }])
    expect(await caller().getGroups()).toEqual([{ id: G }])
    expect(repo.findByUserId).toHaveBeenCalledWith(me)
  })

  it("createGroup は自分をオーナーにして作る", async () => {
    repo.createWithOwner.mockResolvedValue({ id: G })
    await caller().createGroup({ name: "家族" })
    expect(repo.createWithOwner).toHaveBeenCalledWith(expect.objectContaining({ name: "家族", ownerId: me }))
  })

  it("updateGroup はオーナー以外 FORBIDDEN", async () => {
    repo.isOwner.mockResolvedValue(false)
    await expect(caller().updateGroup({ id: G, name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it("updateGroup はオーナーなら更新する", async () => {
    repo.isOwner.mockResolvedValue(true)
    repo.update.mockResolvedValue({ id: G })
    await caller().updateGroup({ id: G, name: "新" })
    expect(repo.update).toHaveBeenCalledWith({ id: G, name: "新" })
  })

  it("deleteGroup はオーナー以外 FORBIDDEN", async () => {
    repo.isOwner.mockResolvedValue(false)
    await expect(caller().deleteGroup({ id: G })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it("deleteGroup はオーナーなら削除する", async () => {
    repo.isOwner.mockResolvedValue(true)
    expect(await caller().deleteGroup({ id: G })).toEqual({ success: true })
    expect(repo.delete).toHaveBeenCalledWith(G)
  })
})

describe("identity: 招待コード", () => {
  it("regenerateInviteCode: オーナー以外は FORBIDDEN", async () => {
    repo.isOwner.mockResolvedValue(false)
    await expect(caller().regenerateInviteCode({ groupId: G })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("regenerateInviteCode: 招待が停止中なら BAD_REQUEST", async () => {
    repo.isOwner.mockResolvedValue(true)
    repo.findById.mockResolvedValue({ id: G, inviteEnabled: false })
    await expect(caller().regenerateInviteCode({ groupId: G })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(repo.regenerateInviteCode).not.toHaveBeenCalled()
  })

  it("regenerateInviteCode: 有効なら再生成する", async () => {
    repo.isOwner.mockResolvedValue(true)
    repo.findById.mockResolvedValue({ id: G, inviteEnabled: true })
    repo.regenerateInviteCode.mockResolvedValue({ id: G })
    await caller().regenerateInviteCode({ groupId: G })
    expect(repo.regenerateInviteCode).toHaveBeenCalledWith(G)
  })

  it("setInviteEnabled: オーナー以外は FORBIDDEN", async () => {
    repo.isOwner.mockResolvedValue(false)
    await expect(caller().setInviteEnabled({ groupId: G, enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(repo.setInviteEnabled).not.toHaveBeenCalled()
  })

  it("setInviteEnabled: オーナーなら切り替える", async () => {
    repo.isOwner.mockResolvedValue(true)
    repo.setInviteEnabled.mockResolvedValue({ id: G })
    await caller().setInviteEnabled({ groupId: G, enabled: false })
    expect(repo.setInviteEnabled).toHaveBeenCalledWith(G, false)
  })
})

describe("identity: メンバー", () => {
  it("getGroupMembers: メンバー以外は FORBIDDEN", async () => {
    repo.isMember.mockResolvedValue(false)
    await expect(caller().getGroupMembers({ groupId: G })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(repo.findMembers).not.toHaveBeenCalled()
  })

  it("getGroupMembers: メンバーなら一覧を返す", async () => {
    repo.isMember.mockResolvedValue(true)
    repo.findMembers.mockResolvedValue([{ userId: me }])
    expect(await caller().getGroupMembers({ groupId: G })).toEqual([{ userId: me }])
  })

  it("removeMember: オーナーでも本人でもなければ FORBIDDEN", async () => {
    repo.isOwner.mockResolvedValue(false)
    await expect(caller().removeMember({ groupId: G, userId: U })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(repo.removeMember).not.toHaveBeenCalled()
  })

  it("removeMember: オーナーは削除できない（BAD_REQUEST）", async () => {
    repo.isOwner.mockResolvedValue(true)
    await expect(caller().removeMember({ groupId: G, userId: U })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(repo.removeMember).not.toHaveBeenCalled()
  })

  it("removeMember: オーナーはほかのメンバーを削除できる", async () => {
    repo.isOwner.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await caller().removeMember({ groupId: G, userId: U })).toEqual({ success: true })
    expect(repo.removeMember).toHaveBeenCalledWith(G, U)
  })

  it("removeMember: メンバー本人は脱退できる", async () => {
    repo.isOwner.mockResolvedValue(false)
    const self = identityRouter.createCaller({ userId: U } as never)
    expect(await self.removeMember({ groupId: G, userId: U })).toEqual({ success: true })
    expect(repo.removeMember).toHaveBeenCalledWith(G, U)
  })
})

describe("identity.inviteMember", () => {
  it("オーナー以外は FORBIDDEN", async () => {
    repo.isOwner.mockResolvedValue(false)
    await expect(caller().inviteMember({ groupId: G })).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("招待が停止中なら BAD_REQUEST", async () => {
    repo.isOwner.mockResolvedValue(true)
    repo.findById.mockResolvedValue({ inviteEnabled: false })
    await expect(caller().inviteMember({ groupId: G })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("64 文字のトークンと 7 日後の期限で招待を作る", async () => {
    repo.isOwner.mockResolvedValue(true)
    repo.findById.mockResolvedValue({ inviteEnabled: true })
    repo.createInvite.mockImplementation(async (i: { token: string; expiresAt: Date }) => i)
    const res = await caller().inviteMember({ groupId: G })
    expect(res.token).toMatch(/^[0-9a-f]{64}$/)
    const diff = res.expiresAt.getTime() - Date.now()
    expect(diff).toBeGreaterThan(6.9 * day)
    expect(diff).toBeLessThan(7.1 * day)
  })
})

describe("identity.acceptInvite", () => {
  const valid = { id: "inv", groupId: G, expiresAt: new Date(Date.now() + day), usedAt: null }

  it("トークンが見つからなければ NOT_FOUND", async () => {
    repo.findInviteByToken.mockResolvedValue(null)
    await expect(caller().acceptInvite({ token: "t" })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("期限切れなら BAD_REQUEST", async () => {
    repo.findInviteByToken.mockResolvedValue({ ...valid, expiresAt: new Date(Date.now() - 1000) })
    await expect(caller().acceptInvite({ token: "t" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("有効期限") })
  })

  it("使用済みなら BAD_REQUEST", async () => {
    repo.findInviteByToken.mockResolvedValue({ ...valid, usedAt: new Date() })
    await expect(caller().acceptInvite({ token: "t" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("使用") })
  })

  it("すでにメンバーなら BAD_REQUEST", async () => {
    repo.findInviteByToken.mockResolvedValue(valid)
    repo.isMember.mockResolvedValue(true)
    await expect(caller().acceptInvite({ token: "t" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(repo.acceptInvite).not.toHaveBeenCalled()
  })

  it("同時に参加された一意制約違反は『既にメンバー』にする", async () => {
    repo.findInviteByToken.mockResolvedValue(valid)
    repo.isMember.mockResolvedValue(false)
    repo.acceptInvite.mockRejectedValue({ code: "23505" })
    await expect(caller().acceptInvite({ token: "t" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("メンバー") })
  })

  it("一意制約以外のエラーはそのまま投げる", async () => {
    repo.findInviteByToken.mockResolvedValue(valid)
    repo.isMember.mockResolvedValue(false)
    repo.acceptInvite.mockRejectedValue(new Error("db down"))
    await expect(caller().acceptInvite({ token: "t" })).rejects.toThrow("db down")
  })

  it("先に別のユーザーが使っていたら（確保できなかったら）BAD_REQUEST", async () => {
    repo.findInviteByToken.mockResolvedValue(valid)
    repo.isMember.mockResolvedValue(false)
    repo.acceptInvite.mockResolvedValue(false)
    await expect(caller().acceptInvite({ token: "t" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("使用") })
  })

  it("承認できたらグループを返す", async () => {
    repo.findInviteByToken.mockResolvedValue(valid)
    repo.isMember.mockResolvedValue(false)
    repo.acceptInvite.mockResolvedValue(true)
    repo.findById.mockResolvedValue({ id: G })
    expect(await caller().acceptInvite({ token: "t" })).toEqual({ id: G })
    expect(repo.acceptInvite).toHaveBeenCalledWith(expect.objectContaining({ inviteId: "inv", groupId: G, userId: me }))
  })
})

describe("identity.joinByInviteCode", () => {
  const group = { id: G, inviteEnabled: true, inviteCodeExpiresAt: new Date(Date.now() + day) }

  it("試行回数が上限ちょうどならまだ試せる", async () => {
    repo.recordInviteCodeAttempt.mockResolvedValue(INVITE_CODE_MAX_ATTEMPTS)
    repo.findByInviteCode.mockResolvedValue(null)
    await expect(caller().joinByInviteCode({ inviteCode: "ABCDEFGH" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(repo.findByInviteCode).toHaveBeenCalled()
  })

  it("試行回数が上限を超えたら TOO_MANY_REQUESTS でコードを調べない", async () => {
    repo.recordInviteCodeAttempt.mockResolvedValue(INVITE_CODE_MAX_ATTEMPTS + 1)
    await expect(caller().joinByInviteCode({ inviteCode: "ABCDEFGH" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" })
    expect(repo.findByInviteCode).not.toHaveBeenCalled()
  })

  it.each([
    ["見つからない", null],
    ["招待が停止中", { ...group, inviteEnabled: false }],
    ["期限切れ", { ...group, inviteCodeExpiresAt: new Date(Date.now() - 1000) }],
  ])("%s ときは同じエラーメッセージを返す", async (_n, g) => {
    repo.recordInviteCodeAttempt.mockResolvedValue(1)
    repo.findByInviteCode.mockResolvedValue(g)
    const err = await caller().joinByInviteCode({ inviteCode: "ABCDEFGH" }).catch((e) => e)
    expect(err.code).toBe("BAD_REQUEST")
    expect(err.message).toContain("招待コードが無効")
  })

  it("すでにメンバーなら BAD_REQUEST", async () => {
    repo.recordInviteCodeAttempt.mockResolvedValue(1)
    repo.findByInviteCode.mockResolvedValue(group)
    repo.isMember.mockResolvedValue(true)
    await expect(caller().joinByInviteCode({ inviteCode: "ABCDEFGH" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(repo.addMember).not.toHaveBeenCalled()
  })

  it("参加できたら member として追加してグループを返す", async () => {
    repo.recordInviteCodeAttempt.mockResolvedValue(1)
    repo.findByInviteCode.mockResolvedValue(group)
    repo.isMember.mockResolvedValue(false)
    expect(await caller().joinByInviteCode({ inviteCode: "ABCDEFGH" })).toEqual(group)
    expect(repo.addMember).toHaveBeenCalledWith(expect.objectContaining({ groupId: G, userId: me, role: "member" }))
  })
})
