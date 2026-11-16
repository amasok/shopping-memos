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
      .mockResolvedValue({ success: true, mergedCounts: {}, errors: [] })
    state.findByUserId.mockReset().mockResolvedValue([])
    state.getChangedEntities
      .mockReset()
      .mockResolvedValue({
        items: [],
        tags: [],
        lists: [],
        listItems: [],
        history: [],
      })
  })

  it("不正な ID のデータは BAD_REQUEST になり、マージを呼ばない", async () => {
    await expect(
      call({
        ...empty,
        items: [
          {
            id: "",
            name: "x",
            quantity: 1,
            tagIds: [],
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    expect(state.merge).not.toHaveBeenCalled()
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
})
