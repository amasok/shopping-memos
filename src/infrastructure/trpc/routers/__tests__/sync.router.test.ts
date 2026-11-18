// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const syncRepo = vi.hoisted(() => ({
  createOperation: vi.fn(), getChangedEntities: vi.fn(), countPendingOperations: vi.fn(),
}))
const pushService = vi.hoisted(() => vi.fn())
const pullService = vi.hoisted(() => vi.fn())
const groupRepo = vi.hoisted(() => ({ findByUserId: vi.fn() }))
const merge = vi.hoisted(() => vi.fn())

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({ syncRepository: syncRepo }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({ groupRepository: groupRepo }))
vi.mock("@/modules/sync/application/services/DataMergeService", () => ({ dataMergeService: { merge } }))
vi.mock("@/modules/sync/application/services/SyncPushService", () => ({ syncPushService: { push: pushService } }))
vi.mock("@/modules/sync/application/services/SyncPullService", async (orig) => ({
  ...(await orig<typeof import("@/modules/sync/application/services/SyncPullService")>()),
  syncPullService: { pull: pullService },
}))

import { syncRouter } from "../sync"

const OP = "11111111-1111-4111-8111-111111111111"
const ENT = "33333333-3333-4333-8333-333333333333"
const G1 = "22222222-2222-4222-8222-222222222221"
const caller = () => syncRouter.createCaller({ userId: "user-1" } as never)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("sync.push", () => {
  const push = (protocolVersion: number) =>
    caller().push({
      protocolVersion,
      operations: [{ opId: OP, entity: "item", entityId: ENT, type: "update", patch: { name: "x" }, clientTime: "2026-03-01T00:00:00.000Z" }],
    })

  it("対応しているプロトコルなら、ユーザーと操作をそのまま SyncPushService に渡す（#62 O4）", async () => {
    pushService.mockResolvedValue({ serverTime: "t", results: [] })
    expect(await push(1)).toEqual({ serverTime: "t", results: [] })
    expect(pushService).toHaveBeenCalledWith("user-1", [expect.objectContaining({ opId: OP, entityId: ENT })])
  })

  it("対応外の protocolVersion は CLIENT_TOO_OLD（PRECONDITION_FAILED）で、何も適用しない", async () => {
    await expect(push(0)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "CLIENT_TOO_OLD" })
    await expect(push(2)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "CLIENT_TOO_OLD" })
    expect(pushService).not.toHaveBeenCalled()
  })

  it("101 件以上の操作は入力の検証で拒否する", async () => {
    const operations = Array.from({ length: 101 }, () => ({
      opId: OP, entity: "item" as const, entityId: ENT, type: "delete" as const, clientTime: "2026-03-01T00:00:00.000Z",
    }))
    await expect(caller().push({ protocolVersion: 1, operations })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(pushService).not.toHaveBeenCalled()
  })
})

describe("sync.pull（#62 O5）", () => {
  it("ユーザーとカーソルを SyncPullService に渡し、結果をそのまま返す", async () => {
    const out = { serverTime: "t", changes: { tags: [], items: [], lists: [], listItems: [] }, memberships: { groupIds: [] }, nextCursor: "c", hasMore: false }
    pullService.mockResolvedValue(out)
    expect(await caller().pull({ protocolVersion: 1, cursor: "abc" })).toEqual(out)
    expect(pullService).toHaveBeenCalledWith("user-1", "abc")
  })

  it("対応外の protocolVersion は CLIENT_TOO_OLD で、何も読まない", async () => {
    await expect(caller().pull({ protocolVersion: 2 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "CLIENT_TOO_OLD" })
    expect(pullService).not.toHaveBeenCalled()
  })

  it("カーソルが不正なら BAD_REQUEST", async () => {
    const { InvalidCursorError } = await vi.importActual<typeof import("@/modules/sync/application/services/SyncPullService")>(
      "@/modules/sync/application/services/SyncPullService"
    )
    pullService.mockRejectedValue(new InvalidCursorError())
    await expect(caller().pull({ protocolVersion: 1, cursor: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("ほかのエラーはそのまま投げる", async () => {
    pullService.mockRejectedValue(new Error("db"))
    await expect(caller().pull({ protocolVersion: 1 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" })
  })
})

describe("sync.getStatus", () => {
  it("未送信の操作数を返す", async () => {
    syncRepo.countPendingOperations.mockResolvedValue(3)
    expect(await caller().getStatus()).toEqual({ pendingCount: 3, lastSyncAt: null })
    expect(syncRepo.countPendingOperations).toHaveBeenCalledWith("user-1")
  })
})

describe("sync.merge", () => {
  const empty = { items: [], tags: [], lists: [], listItems: [], history: [] }
  const okResult = {
    success: true, errors: [], failedCount: 0, failedRecords: [], idMappings: { tags: {} },
    mergedCounts: { items: 0 }, alreadyMergedCount: 0, fatal: false,
  }

  it("全体が失敗したら INTERNAL_SERVER_ERROR にして、完了扱いにしない", async () => {
    merge.mockResolvedValue({ ...okResult, success: false, fatal: true, errors: ["tx"] })
    await expect(caller().merge({ data: empty })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" })
    expect(syncRepo.getChangedEntities).not.toHaveBeenCalled()
  })

  it("成功したらサーバーのデータとマッピングを返す", async () => {
    merge.mockResolvedValue(okResult)
    groupRepo.findByUserId.mockResolvedValue([{ id: G1 }])
    syncRepo.getChangedEntities.mockResolvedValue({ items: [], tags: [], lists: [], listItems: [], history: [] })
    const res = await caller().merge({ data: empty })
    expect(res.mergeResult).toMatchObject({ success: true, notImportedCount: 0, notImported: [], errors: [] })
    expect(res.idMappings).toEqual({ tags: {} })
    expect(syncRepo.getChangedEntities).toHaveBeenCalledWith([G1])
  })

  it("形式が不正な要素は取り込めなかった件数に数え、成功扱いにしない", async () => {
    merge.mockResolvedValue(okResult)
    groupRepo.findByUserId.mockResolvedValue([])
    syncRepo.getChangedEntities.mockResolvedValue({ items: [], tags: [], lists: [], listItems: [], history: [] })
    const res = await caller().merge({ data: { ...empty, items: [{ bogus: true }] } })
    expect(res.mergeResult.success).toBe(false)
    expect(res.mergeResult.notImportedCount).toBe(1)
    expect(res.mergeResult.notImported).toEqual([{ entity: "items", requestIndex: 0 }])
  })

  it("サービスで失敗したレコードは、リクエスト内の位置に直して返す", async () => {
    merge.mockResolvedValue({ ...okResult, success: false, failedCount: 1, errors: ["e"], failedRecords: [{ entity: "tags", index: 0 }] })
    groupRepo.findByUserId.mockResolvedValue([])
    syncRepo.getChangedEntities.mockResolvedValue({ items: [], tags: [], lists: [], listItems: [], history: [] })
    // 1 件目は形式不正でスキップされ、2 件目（有効）がサービスに渡って失敗する → リクエスト内の位置は 1
    const valid = { id: "44444444-4444-4444-8444-444444444444", name: "食品", createdAt: "2026-03-01T00:00:00Z" }
    const res = await caller().merge({ data: { ...empty, tags: [{ bogus: true }, valid] } })
    expect(res.mergeResult.notImportedCount).toBe(2)
    expect(res.mergeResult.notImported).toEqual([
      { entity: "tags", requestIndex: 0 },
      { entity: "tags", requestIndex: 1 },
    ])
  })
})
