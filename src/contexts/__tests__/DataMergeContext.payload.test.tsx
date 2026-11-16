import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"

const state = vi.hoisted(() => ({
  tags: [] as unknown[],
  items: [] as unknown[],
  lists: [] as unknown[],
  listItems: [] as unknown[],
  mutateAsync: vi.fn(),
}))

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isLoading: false }),
}))
vi.mock("@/lib/db", () => ({
  db: {
    items: { toArray: async () => state.items },
    tags: { toArray: async () => state.tags },
    lists: { toArray: async () => state.lists },
    listItems: { toArray: async () => state.listItems },
  },
}))
vi.mock("@/infrastructure/trpc/client", () => ({
  trpc: { sync: { merge: { useMutation: () => ({ mutateAsync: state.mutateAsync }) } } },
}))

import { DataMergeProvider } from "../DataMergeContext"
import { syncMergeInputSchema } from "@/shared/schemas/sync"

const uuid = () => crypto.randomUUID()
const NOW = new Date("2026-03-01T09:00:00Z")

/** DataMergeContext が実際に送る入力を取り出し、サーバー側のスキーマで検証する */
async function mergePayload() {
  render(
    <DataMergeProvider>
      <div />
    </DataMergeProvider>
  )
  await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(1))
  return state.mutateAsync.mock.calls[0][0]
}

beforeEach(() => {
  localStorage.clear()
  state.mutateAsync.mockReset().mockResolvedValue({
    mergeResult: { success: true, mergedCounts: {}, errors: [] },
  })
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  })
})

describe("DataMergeContext が送る入力は、sync.merge のスキーマを満たす (#86)", () => {
  it("初期状態（デフォルトタグだけ）のゲストデータを受け付ける", async () => {
    // initializeDefaultTags が作るのと同じ形（Dexie には Date で入っている）
    state.tags = ["食品", "日用品", "エンタメ"].map((name) => ({
      id: uuid(),
      name,
      createdAt: NOW,
      updatedAt: NOW,
    }))
    state.items = []
    state.lists = []
    state.listItems = []

    const payload = await mergePayload()

    const parsed = syncMergeInputSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.data.tags.map((t) => t.name)).toEqual(["食品", "日用品", "エンタメ"])
  })

  it("アイテム・進行中リスト・購入済みリスト（履歴）・リストアイテムが混在するデータを受け付ける", async () => {
    const tagId = uuid()
    const inProgressId = uuid()
    const completedId = uuid()
    state.tags = [{ id: tagId, name: "食品", createdAt: NOW, updatedAt: NOW }]
    state.items = [
      // memo・purchasedAt が未設定、購入済み、メモ付きの 3 種
      { id: uuid(), name: "牛乳", quantity: 1, tagIds: [tagId], createdAt: NOW, updatedAt: NOW },
      { id: uuid(), name: "卵", quantity: 2, memo: "https://example.com/egg", tagIds: [], purchasedAt: NOW, createdAt: NOW, updatedAt: NOW },
      { id: uuid(), name: "パン", quantity: 3, memo: "", tagIds: [tagId], createdAt: NOW, updatedAt: NOW },
    ]
    state.lists = [
      { id: inProgressId, name: "今週", status: "in_progress", createdAt: NOW },
      { id: completedId, name: "先週", status: "completed", createdAt: NOW, completedAt: NOW, purchasedAt: NOW, location: "スーパー" },
    ]
    state.listItems = [
      { id: uuid(), listId: inProgressId, name: "牛乳", quantity: 1, tagIds: [tagId], checked: false, createdAt: NOW },
      { id: uuid(), listId: completedId, name: "卵", quantity: 2, memo: "特売", tagIds: [], checked: true, createdAt: NOW },
    ]

    const payload = await mergePayload()

    const parsed = syncMergeInputSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.data.items).toHaveLength(3)
      expect(parsed.data.data.lists).toHaveLength(2)
      expect(parsed.data.data.listItems).toHaveLength(2)
      expect(parsed.data.data.history).toHaveLength(1)
      expect(parsed.data.data.history[0].purchasedAt).toBeInstanceOf(Date)
      expect(parsed.data.data.lists[1].location).toBe("スーパー")
    }
  })

  it("上限ちょうどの値（名前100文字・メモ500文字・タグ名50文字・数量9999）を受け付ける", async () => {
    state.tags = [{ id: uuid(), name: "あ".repeat(50), createdAt: NOW, updatedAt: NOW }]
    state.items = [
      { id: uuid(), name: "い".repeat(100), quantity: 9999, memo: "う".repeat(500), tagIds: [], createdAt: NOW, updatedAt: NOW },
    ]
    state.lists = []
    state.listItems = []

    const payload = await mergePayload()

    expect(syncMergeInputSchema.safeParse(payload).success).toBe(true)
  })
})
