// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const syncRepo = vi.hoisted(() => ({
  checkEntityAccess: vi.fn(), findLatestEntityState: vi.fn(), createOperation: vi.fn(),
  getChangedEntities: vi.fn(), countPendingOperations: vi.fn(),
}))
const groupRepo = vi.hoisted(() => ({ findByUserId: vi.fn() }))
const merge = vi.hoisted(() => vi.fn())

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock("@/modules/sync/infrastructure/repositories/DrizzleSyncRepository", () => ({ syncRepository: syncRepo }))
vi.mock("@/modules/identity/infrastructure/repositories/DrizzleGroupRepository", () => ({ groupRepository: groupRepo }))
vi.mock("@/modules/sync/application/services/DataMergeService", () => ({ dataMergeService: { merge } }))

import { syncRouter } from "../sync"

const OP = "11111111-1111-4111-8111-111111111111"
const OP2 = "11111111-1111-4111-8111-111111111112"
const ENT = "33333333-3333-4333-8333-333333333333"
const G1 = "22222222-2222-4222-8222-222222222221"
const G2 = "22222222-2222-4222-8222-222222222222"
const caller = () => syncRouter.createCaller({ userId: "user-1" } as never)

const op = (id: string, createdAt: string) => ({
  id, entity: "item" as const, entityId: ENT, operation: "update" as const, payload: { name: "x" }, createdAt: new Date(createdAt),
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  syncRepo.checkEntityAccess.mockResolvedValue("allowed")
})

describe("sync.push", () => {
  it("他人のエンティティへの操作は記録せず、処理済みとして返す（競合データも返さない）", async () => {
    syncRepo.checkEntityAccess.mockResolvedValue("denied")
    const res = await caller().push({ operations: [op(OP, "2026-03-01")] })
    expect(res).toEqual({ processedIds: [OP], conflicts: [] })
    expect(syncRepo.findLatestEntityState).not.toHaveBeenCalled()
    expect(syncRepo.createOperation).not.toHaveBeenCalled()
  })

  it("サーバーに状態がなければ操作を記録する", async () => {
    syncRepo.findLatestEntityState.mockResolvedValue(null)
    const res = await caller().push({ operations: [op(OP, "2026-03-01")] })
    expect(res.processedIds).toEqual([OP])
    expect(syncRepo.createOperation).toHaveBeenCalledWith(expect.objectContaining({ id: OP, userId: "user-1", entityId: ENT }))
  })

  it("ローカルのほうが新しければ記録する（Last Write Wins）", async () => {
    syncRepo.findLatestEntityState.mockResolvedValue({ createdAt: new Date("2026-02-01"), payload: "{}" })
    const res = await caller().push({ operations: [op(OP, "2026-03-01")] })
    expect(res.conflicts).toEqual([])
    expect(syncRepo.createOperation).toHaveBeenCalled()
  })

  it("サーバーのほうが新しければ競合として返し、記録しない", async () => {
    syncRepo.findLatestEntityState.mockResolvedValue({ createdAt: new Date("2026-04-01"), payload: '{"name":"server"}' })
    const res = await caller().push({ operations: [op(OP, "2026-03-01")] })
    expect(res.processedIds).toEqual([])
    expect(res.conflicts).toEqual([
      expect.objectContaining({ operationId: OP, entityId: ENT, serverData: { name: "server" }, serverUpdatedAt: new Date("2026-04-01") }),
    ])
    expect(syncRepo.createOperation).not.toHaveBeenCalled()
  })

  it("サーバーに存在しないエンティティは、自分の操作ログだけで競合判定する", async () => {
    syncRepo.checkEntityAccess.mockResolvedValue("not_found")
    syncRepo.findLatestEntityState.mockResolvedValue(null)
    await caller().push({ operations: [op(OP, "2026-03-01")] })
    expect(syncRepo.findLatestEntityState).toHaveBeenCalledWith("item", ENT, { userId: "user-1" })
  })

  it("1 件が失敗しても残りの操作は続けて処理する", async () => {
    syncRepo.findLatestEntityState.mockResolvedValue(null)
    syncRepo.createOperation.mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce(undefined)
    const res = await caller().push({ operations: [op(OP, "2026-03-01"), op(OP2, "2026-03-02")] })
    expect(res.processedIds).toEqual([OP2])
  })
})

describe("sync.pull", () => {
  const changes = { items: [1], tags: [2], lists: [3], listItems: [4], history: [5] }

  it("groupIds 未指定なら所属グループすべての変更を取る", async () => {
    groupRepo.findByUserId.mockResolvedValue([{ id: G1 }, { id: G2 }])
    syncRepo.getChangedEntities.mockResolvedValue(changes)
    const res = await caller().pull({})
    expect(syncRepo.getChangedEntities).toHaveBeenCalledWith([G1, G2], undefined)
    expect(res).toMatchObject({ items: [1], tags: [2], lists: [3], listItems: [4], history: [5], syncedAt: expect.any(Date) })
  })

  it("groupIds は所属グループに絞り、所属していないグループは取らない", async () => {
    groupRepo.findByUserId.mockResolvedValue([{ id: G1 }])
    syncRepo.getChangedEntities.mockResolvedValue(changes)
    const since = new Date("2026-03-01")
    await caller().pull({ groupIds: [G1, G2], since })
    expect(syncRepo.getChangedEntities).toHaveBeenCalledWith([G1], since)
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
