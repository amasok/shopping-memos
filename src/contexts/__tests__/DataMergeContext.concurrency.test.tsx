import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"

const state = vi.hoisted(() => ({
  items: [] as unknown[],
  mutateAsync: vi.fn(),
}))

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isLoading: false }),
}))
vi.mock("@/lib/db", () => ({
  db: {
    items: { toArray: async () => state.items },
    tags: { toArray: async () => [] },
    lists: { toArray: async () => [] },
    listItems: { toArray: async () => [] },
  },
}))
vi.mock("@/infrastructure/trpc/client", () => ({
  trpc: { sync: { merge: { useMutation: () => ({ mutateAsync: state.mutateAsync }) } } },
}))

// merge の後にゲストのデータを消す処理は、この疑似 DB では呼び出しだけを記録する
const guestData = vi.hoisted(() => ({ clearGuestData: vi.fn(async () => {}) }))
vi.mock("@/lib/db/guestData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/guestData")>()),
  clearGuestData: guestData.clearGuestData,
}))

import { DataMergeProvider, useDataMerge } from "../DataMergeContext"
import { MERGE_LIMITS } from "@/shared/schemas/sync"

const NOW = new Date("2026-03-01T09:00:00Z")
const MERGE_KEY = "data-merge-completed-user-1"

const ok = { mergeResult: { success: true, mergedCounts: {}, notImportedCount: 0, errors: [] } }
const item = (i: number) => ({
  id: crypto.randomUUID(),
  name: `アイテム${i}`,
  quantity: 1,
  tagIds: [],
  createdAt: NOW,
  updatedAt: NOW,
})

function Probe() {
  const { retryMerge, isMerging } = useDataMerge()
  return (
    <div>
      <span data-testid="merging">{String(isMerging)}</span>
      <button onClick={retryMerge}>retry</button>
    </div>
  )
}

let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  // 2 回に分けて送られる件数
  state.items = Array.from({ length: MERGE_LIMITS.items + 1 }, (_, i) => item(i))
  state.mutateAsync.mockReset()
  reload = vi.fn()
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  })
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("DataMergeContext: merge の二重実行の防止 (#116)", () => {
  it("送信中に再試行を押しても、2 本目の merge は走らず、同じデータを二重に送らない", async () => {
    let release!: () => void
    state.mutateAsync
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(ok))))
      .mockResolvedValue(ok)

    render(
      <DataMergeProvider>
        <Probe />
      </DataMergeProvider>
    )
    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(1))

    // 1 つ目のリクエストが返る前に、再試行を押す（2 回）
    fireEvent.click(screen.getByText("retry"))
    fireEvent.click(screen.getByText("retry"))
    await act(async () => {})
    expect(state.mutateAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
    })
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))

    // 全体で 2 回（分割した分）だけ。再試行で増えていない
    expect(state.mutateAsync).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
  })

  it("完了したあとの再試行（印を消して最初から）は、もう一度最後まで走る", async () => {
    state.mutateAsync.mockResolvedValue(ok)
    render(
      <DataMergeProvider>
        <Probe />
      </DataMergeProvider>
    )
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(state.mutateAsync).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByText("retry"))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2))

    expect(state.mutateAsync).toHaveBeenCalledTimes(4)
  })
})
