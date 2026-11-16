import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  merge: vi.fn(),
  findByUserId: vi.fn(),
  getChangedEntities: vi.fn(),
}))

vi.mock("@/infrastructure/auth", () => ({ auth: vi.fn() }))
vi.mock(
  "@/modules/identity/infrastructure/repositories/DrizzleGroupRepository",
  () => ({
    groupRepository: { findByUserId: state.findByUserId },
  }),
)
vi.mock("@/modules/sync/application/services/DataMergeService", () => ({
  dataMergeService: { merge: state.merge },
}))
vi.mock(
  "@/modules/sync/infrastructure/repositories/DrizzleSyncRepository",
  () => ({
    syncRepository: { getChangedEntities: state.getChangedEntities },
  }),
)

import { syncRouter } from "@/infrastructure/trpc/routers/sync"

const empty = { items: [], tags: [], lists: [], listItems: [], history: [] }
const call = (data: unknown) =>
  syncRouter.createCaller({ userId: "user-me" }).merge({ data } as never)

describe("sync.merge の入力検証 (#86)", () => {
  beforeEach(() => {
    state.merge
      .mockReset()
      .mockResolvedValue({
        success: true,
        mergedCounts: {},
        failedCount: 0,
        failedRecords: [],
        alreadyMergedCount: 0,
        fatal: false,
        idMappings: [],
        errors: [],
      })
    state.findByUserId.mockReset().mockResolvedValue([])
    state.getChangedEntities.mockReset().mockResolvedValue({
      items: [],
      tags: [],
      lists: [],
      listItems: [],
      history: [],
    })
  })

  it("形式が不正な 1 件はスキップして errors に入れ、ほかのデータは DataMergeService に渡す", async () => {
    const goodId = crypto.randomUUID()
    const item = (itemId: string) => ({
      id: itemId,
      name: "x",
      quantity: 1,
      tagIds: [],
      createdAt: "2026-01-01T00:00:00Z",
    })
    const result = await call({ ...empty, items: [item(""), item(goodId)] })

    expect(state.merge).toHaveBeenCalledTimes(1)
    const [, data] = state.merge.mock.calls[0]
    expect(data.items.map((i: { id: string }) => i.id)).toEqual([goodId])
    expect(result.mergeResult.success).toBe(false)
    expect(result.mergeResult.errors).toEqual([
      expect.stringContaining("アイテム 1 件目"),
    ])
  })

  it("上限を超える件数は BAD_REQUEST になる", async () => {
    const item = {
      id: crypto.randomUUID(),
      name: "x",
      quantity: 1,
      tagIds: [],
      createdAt: "2026-01-01T00:00:00Z",
    }
    await expect(
      call({ ...empty, items: Array.from({ length: 1001 }, () => item) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    })
  })

  it("正しいデータは変換済み（Date）のまま DataMergeService に渡される", async () => {
    const id = crypto.randomUUID()
    await call({
      ...empty,
      tags: [{ id, name: "食品", createdAt: "2026-01-01T00:00:00.000Z" }],
    })
    expect(state.merge).toHaveBeenCalledTimes(1)
    const [userId, data] = state.merge.mock.calls[0]
    expect(userId).toBe("user-me")
    expect(data.tags[0].createdAt).toBeInstanceOf(Date)
    expect(data.tags[0].id).toBe(id)
  })

  it("取り込めなかった件数は、検証でスキップした件数とレコード単位の失敗だけを数える (#116)", async () => {
    state.merge.mockResolvedValue({
      success: false,
      mergedCounts: {},
      failedCount: 1,
      failedRecords: [{ entity: "tags", index: 0 }],
      alreadyMergedCount: 3,
      fatal: false,
      errors: [
        'タグ "重複" のマージに失敗',
        'アイテム "牛乳" のタグの関連付けをスキップ（タグにアクセスできません）',
      ],
    })
    const badItem = { id: "", name: "x", quantity: 1, tagIds: [], createdAt: "2026-01-01T00:00:00Z" }
    const result = await call({ ...empty, items: [badItem] })

    // 検証のスキップ 1 件 + レコード単位の失敗 1 件。タグの関連付けと取り込み済み 3 件は数えない
    expect(result.mergeResult.notImportedCount).toBe(2)
    expect(result.mergeResult.alreadyMergedCount).toBe(3)
    expect(result.mergeResult.errors).toHaveLength(3)
  })

  it("トランザクション全体が失敗したら、完了扱いにせず INTERNAL_SERVER_ERROR にする (#116)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.merge.mockResolvedValue({
      success: false,
      mergedCounts: { items: 0, tags: 0, lists: 0, listItems: 0, history: 0 },
      failedCount: 0,
      failedRecords: [],
      alreadyMergedCount: 0,
      fatal: true,
      errors: ["マージ処理に失敗しました: connection lost"],
    })
    await expect(call(empty)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" })
    expect(state.getChangedEntities).not.toHaveBeenCalled()
  })

  it("付け替えたタグの ID（idMappings）を、そのままクライアントに返す", async () => {
    const mappings = [{ entity: "tag", localId: crypto.randomUUID(), serverId: crypto.randomUUID() }]
    state.merge.mockResolvedValue({
      success: true,
      mergedCounts: {},
      failedCount: 0,
      failedRecords: [],
      alreadyMergedCount: 0,
      fatal: false,
      idMappings: mappings,
      errors: [],
    })
    const result = await call(empty)
    expect(result.idMappings).toEqual(mappings)
  })

  it("取り込めなかったレコードを、リクエストの中での位置（notImported）で返す (#144)", async () => {
    const item = (id: string) => ({ id, name: "x", quantity: 1, tagIds: [], createdAt: "2026-01-01T00:00:00Z" })
    const ok1 = crypto.randomUUID()
    const ok2 = crypto.randomUUID()
    // DataMergeService は、検証を通った items（ok1, ok2）の 2 件目が失敗したと返す
    state.merge.mockResolvedValue({
      success: false,
      mergedCounts: {},
      failedCount: 1,
      failedRecords: [{ entity: "items", index: 1 }],
      alreadyMergedCount: 0,
      fatal: false,
      idMappings: [],
      errors: ["アイテム \"x\" のマージに失敗"],
    })

    // リクエストの items: [ok1, 不正（ID が空）, ok2]
    const result = await call({ ...empty, items: [item(ok1), item(""), item(ok2)] })

    expect(result.mergeResult.notImported).toEqual([
      { entity: "items", requestIndex: 1 }, // 検証でスキップした 2 件目
      { entity: "items", requestIndex: 2 }, // サービスで失敗した（検証を通った中の 2 件目 = リクエストの 3 件目）
    ])
    expect(result.mergeResult.notImportedCount).toBe(result.mergeResult.notImported.length)
  })
})
