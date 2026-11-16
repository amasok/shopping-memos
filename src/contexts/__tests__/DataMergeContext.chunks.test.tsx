import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

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

// merge の後にゲストのデータを消す処理は、この疑似 DB では呼び出しだけを記録する
const guestData = vi.hoisted(() => ({
  clearGuestData: vi.fn(async () => {}),
  applyMergeOutcome: vi.fn<(userId: string, outcome: unknown) => Promise<void>>(async () => {}),
}))
vi.mock("@/lib/db/guestData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/guestData")>()),
  clearGuestData: guestData.clearGuestData,
  // ゲストの DB の読み書きは、このテストの疑似 DB（@/lib/db のモック）から読み、結果の反映は呼び出しだけを記録する
  loadGuestDataForMerge: async () => {
    const { db } = await import("@/lib/db")
    return {
      tags: await db.tags.toArray(),
      items: await db.items.toArray(),
      lists: await db.lists.toArray(),
      listItems: await db.listItems.toArray(),
    }
  },
  applyMergeOutcome: guestData.applyMergeOutcome,
  // 以前の仕組みからの移行は guestData.test.ts で確かめる
  ensureGuestDataMigrated: async () => true,
}))

import { DataMergeProvider, useDataMerge } from "../DataMergeContext"
import { MERGE_LIMITS, syncMergeStrictInputSchema } from "@/shared/schemas/sync"
import { REQUEST_LIMITS } from "@/shared/schemas/limits"

const NOW = new Date("2026-03-01T09:00:00Z")
const MERGE_KEY = "data-merge-completed-user-1"
const SKIPPED_KEY = "data-merge-skipped-user-1"

type Payload = { data: Record<"tags" | "items" | "lists" | "listItems" | "history", Array<{ id: string }>> }

const ok = (notImportedCount = 0) => ({
  mergeResult: { success: notImportedCount === 0, mergedCounts: {}, notImportedCount, errors: [] },
})

const tag = (i: number) => ({ id: crypto.randomUUID(), name: `タグ${i}`, createdAt: NOW, updatedAt: NOW })
const item = (i: number, memo?: string) => ({
  id: crypto.randomUUID(),
  name: `アイテム${i}`,
  quantity: 1,
  memo,
  tagIds: [],
  createdAt: NOW,
  updatedAt: NOW,
})

function Probe() {
  const { error, retryMerge } = useDataMerge()
  return (
    <div>
      <span data-testid="error">{error ?? ""}</span>
      <button onClick={retryMerge}>retry</button>
    </div>
  )
}

const renderProvider = () =>
  render(
    <DataMergeProvider>
      <Probe />
    </DataMergeProvider>
  )

const sentPayloads = () => state.mutateAsync.mock.calls.map((c) => c[0] as Payload)
const sentIds = (key: keyof Payload["data"]) => sentPayloads().flatMap((p) => p.data[key].map((r) => r.id))

let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  state.tags = []
  state.items = []
  state.lists = []
  state.listItems = []
  state.mutateAsync.mockReset().mockResolvedValue(ok())
  reload = vi.fn()
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  })
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("DataMergeContext の分割送信 (#116)", () => {
  it("件数の上限を超えるゲストデータを、上限以内に分けて全件送り、最後に完了の印を付ける", async () => {
    state.tags = Array.from({ length: 3 }, (_, i) => tag(i))
    state.items = Array.from({ length: MERGE_LIMITS.items * 2 + 5 }, (_, i) => item(i))

    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())

    const payloads = sentPayloads()
    expect(payloads).toHaveLength(3)
    for (const payload of payloads) {
      // サーバーと同じスキーマ（件数の上限を含む）を満たす
      expect(syncMergeStrictInputSchema.safeParse(payload).success).toBe(true)
    }
    expect(sentIds("items")).toEqual((state.items as Array<{ id: string }>).map((i) => i.id))
    // タグ（参照される側）は最初のリクエストで送る
    expect(payloads[0].data.tags).toHaveLength(3)
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
  })

  it("1 回のリクエストの大きさがボディの上限を超えない", async () => {
    // 1 件約 6KB × 1000 件 ≒ 6MB（4MB の上限を超える）
    state.items = Array.from({ length: MERGE_LIMITS.items }, (_, i) => item(i, "あ".repeat(2000)))

    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())

    const payloads = sentPayloads()
    expect(payloads.length).toBeGreaterThan(1)
    for (const payload of payloads) {
      expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(REQUEST_LIMITS.mergeBodyBytes)
    }
    expect(sentIds("items")).toHaveLength(MERGE_LIMITS.items)
  })

  it("取り込めなかった件数は、各リクエストの notImportedCount の合計を保存する", async () => {
    state.items = Array.from({ length: MERGE_LIMITS.items + 1 }, (_, i) => item(i))
    state.mutateAsync.mockResolvedValueOnce(ok(2)).mockResolvedValueOnce(ok(1))

    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())

    expect(state.mutateAsync).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(SKIPPED_KEY)).toBe("3")
  })

  it("途中で失敗したら完了の印を付けず、再試行で最後まで送ると完了する（件数は再試行の分だけを数える）", async () => {
    state.items = Array.from({ length: MERGE_LIMITS.items * 2 + 1 }, (_, i) => item(i))
    state.mutateAsync
      .mockResolvedValueOnce(ok(1)) // 1 回目: 1 つ目は成功
      .mockRejectedValueOnce(new Error("network error")) // 1 回目: 2 つ目で失敗

    renderProvider()
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("network error"))
    expect(localStorage.getItem(MERGE_KEY)).toBeNull()
    expect(localStorage.getItem(SKIPPED_KEY)).toBeNull()
    expect(reload).not.toHaveBeenCalled()

    // 再試行: サーバーは取り込み済みを失敗に数えないので、1 つ目の分の notImportedCount は 1 のまま
    state.mutateAsync.mockReset().mockResolvedValueOnce(ok(1)).mockResolvedValue(ok(0))
    fireEvent.click(screen.getByText("retry"))
    await waitFor(() => expect(reload).toHaveBeenCalled())

    expect(state.mutateAsync).toHaveBeenCalledTimes(3)
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
    // 失敗した 1 回目の分（1 件）は足し込まれない
    expect(localStorage.getItem(SKIPPED_KEY)).toBe("1")
  })

  it("前のリクエストで付け替えられたタグの ID を、後から送るアイテムの tagIds に反映する", async () => {
    const guestTag = tag(0)
    state.tags = [guestTag]
    // 1 つ目のリクエストにタグと 1000 件のアイテム、2 つ目に残りのアイテムが入る
    state.items = Array.from({ length: MERGE_LIMITS.items + 1 }, (_, i) => ({ ...item(i), tagIds: [guestTag.id] }))
    state.mutateAsync
      .mockResolvedValueOnce({
        ...ok(),
        idMappings: [{ entity: "tag", localId: guestTag.id, serverId: "server-tag" }],
      })
      .mockResolvedValue({ ...ok(), idMappings: [] })

    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())

    const [first, second] = sentPayloads() as unknown as Array<{ data: { items: Array<{ tagIds: string[] }> } }>
    // 1 つ目は元の ID のまま（同じリクエストの中は、サーバーが付け替える）
    expect(first.data.items[0].tagIds).toEqual([guestTag.id])
    // 2 つ目は付け替え後の ID
    expect(second.data.items.every((i) => i.tagIds[0] === "server-tag")).toBe(true)
  })
})
