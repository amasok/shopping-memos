import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  access: "allowed" as "allowed" | "denied" | "not_found",
  latest: null as null | { createdAt: Date; payload: string },
  findLatest: vi.fn(),
  checkAccess: vi.fn(),
  createOperation: vi.fn(),
}))

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({
  groupRepository: { findByUserId: vi.fn() },
}))
vi.mock("@/modules/sync/application/services/DataMergeService", () => ({
  dataMergeService: { merge: vi.fn() },
}))
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({
  syncRepository: {
    checkEntityAccess: state.checkAccess,
    findLatestEntityState: state.findLatest,
    createOperation: state.createOperation,
  },
}))

import { syncRouter } from "@/infrastructure/trpc/routers/sync"

const OP_ID = "11111111-1111-4111-8111-111111111111"
const ENTITY_ID = "22222222-2222-4222-8222-222222222222"

const op = (createdAt: Date) => ({
  id: OP_ID,
  entity: "item" as const,
  entityId: ENTITY_ID,
  operation: "update" as const,
  payload: { name: "牛乳" },
  createdAt,
})
const push = (createdAt = new Date("2026-02-01T00:00:00Z")) =>
  syncRouter.createCaller({ userId: "user-me" }).push({ operations: [op(createdAt)] })

describe("sync.push の認可 (#69)", () => {
  beforeEach(() => {
    state.access = "allowed"
    state.latest = null
    state.checkAccess.mockReset().mockImplementation(async () => state.access)
    state.findLatest.mockReset().mockImplementation(async () => state.latest)
    state.createOperation.mockReset().mockResolvedValue(undefined)
  })

  it("他人のエンティティへの操作は記録せず、競合データも返さず、キューから消すためIDだけ処理済みにする", async () => {
    state.access = "denied"
    state.latest = { createdAt: new Date("2030-01-01"), payload: JSON.stringify({ secret: "他人のデータ" }) }

    const res = await push()

    expect(res.processedIds).toEqual([OP_ID])
    expect(res.conflicts).toEqual([])
    expect(state.createOperation).not.toHaveBeenCalled()
    expect(state.findLatest).not.toHaveBeenCalled()
    expect(JSON.stringify(res)).not.toContain("他人のデータ")
  })

  it("アクセス権の確認はログインユーザーのIDで行う", async () => {
    await push()

    expect(state.checkAccess).toHaveBeenCalledWith("item", ENTITY_ID, "user-me")
  })

  it("アクセスできるエンティティは全操作ログを競合判定に使い、新しい操作なら記録する", async () => {
    state.latest = { createdAt: new Date("2026-01-01"), payload: "{}" }

    const res = await push(new Date("2026-02-01"))

    expect(state.findLatest).toHaveBeenCalledWith("item", ENTITY_ID, undefined)
    expect(state.createOperation).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-me", entityId: ENTITY_ID }))
    expect(res.processedIds).toEqual([OP_ID])
    expect(res.conflicts).toEqual([])
  })

  it("サーバー側が新しければ競合として返し、記録しない（Last Write Wins）", async () => {
    state.latest = { createdAt: new Date("2026-03-01"), payload: JSON.stringify({ name: "サーバー" }) }

    const res = await push(new Date("2026-02-01"))

    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0].serverData).toEqual({ name: "サーバー" })
    expect(res.processedIds).toEqual([])
    expect(state.createOperation).not.toHaveBeenCalled()
  })

  it("サーバーに存在しないエンティティは、自分の操作ログだけを競合判定に使う", async () => {
    state.access = "not_found"

    await push()

    expect(state.findLatest).toHaveBeenCalledWith("item", ENTITY_ID, { userId: "user-me" })
    expect(state.createOperation).toHaveBeenCalled()
  })

  it("複数操作では denied の操作だけが破棄され、他の操作は処理される", async () => {
    const OP2 = "33333333-3333-4333-8333-333333333333"
    const ENTITY2 = "44444444-4444-4444-8444-444444444444"
    state.checkAccess.mockImplementation(async (_e: string, id: string) => (id === ENTITY_ID ? "denied" : "allowed"))

    const res = await syncRouter.createCaller({ userId: "user-me" }).push({
      operations: [
        op(new Date("2026-02-01")),
        { ...op(new Date("2026-02-01")), id: OP2, entityId: ENTITY2 },
      ],
    })

    expect(res.processedIds).toEqual([OP_ID, OP2])
    expect(state.createOperation).toHaveBeenCalledTimes(1)
    expect(state.createOperation).toHaveBeenCalledWith(expect.objectContaining({ entityId: ENTITY2 }))
  })
})
