import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

/**
 * ゲストのデータとログイン・ログアウト（offline-support.md「ゲストのデータとログイン・ログアウト」）
 */
const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  isLoading: false,
  tags: [] as unknown[],
  items: [] as unknown[],
  mutateAsync: vi.fn(),
}))

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: state.user, isLoading: state.isLoading }),
}))
vi.mock("@/lib/db", () => ({
  db: {
    items: { toArray: async () => state.items },
    tags: { toArray: async () => state.tags },
    lists: { toArray: async () => [] },
    listItems: { toArray: async () => [] },
  },
}))
vi.mock("@/infrastructure/trpc/client", () => ({
  trpc: { sync: { merge: { useMutation: () => ({ mutateAsync: state.mutateAsync }) } } },
}))
const guestData = vi.hoisted(() => ({ clearGuestData: vi.fn(async () => {}) }))
vi.mock("@/lib/db/guestData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/guestData")>()),
  clearGuestData: guestData.clearGuestData,
}))

import { DataMergeProvider, useDataMerge } from "../DataMergeContext"

const NOW = new Date("2026-03-01T09:00:00Z")
const MERGE_KEY = "data-merge-completed-user-1"
const SKIPPED_KEY = "data-merge-skipped-user-1"
const defaultTags = () =>
  ["食品", "日用品", "エンタメ"].map((name) => ({ id: crypto.randomUUID(), name, createdAt: NOW, updatedAt: NOW }))
const guestItem = () => ({ id: crypto.randomUUID(), name: "牛乳", quantity: 1, tagIds: [], createdAt: NOW, updatedAt: NOW })
const result = (notImportedCount: number) => ({
  idMappings: [],
  mergeResult: { success: notImportedCount === 0, mergedCounts: {}, notImportedCount, errors: [] },
})

function Probe() {
  const { isMergeCompleted } = useDataMerge()
  return <span data-testid="completed">{String(isMergeCompleted)}</span>
}
const renderProvider = () =>
  render(
    <DataMergeProvider>
      <Probe />
    </DataMergeProvider>
  )

let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  state.user = { id: "user-1" }
  state.isLoading = false
  state.tags = defaultTags()
  state.items = []
  state.mutateAsync.mockReset().mockResolvedValue(result(0))
  guestData.clearGuestData.mockClear()
  reload = vi.fn()
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } })
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("ログインしたときの merge", () => {
  it("初期タグだけのゲストは merge せず、そのままサーバーのデータに切り替える", async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId("completed")).toHaveTextContent("true"))
    expect(state.mutateAsync).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
  })

  it("全部取り込めたら、ゲストのデータを空にしてから再読み込みする", async () => {
    state.items = [guestItem()]
    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(state.mutateAsync).toHaveBeenCalledTimes(1)
    expect(guestData.clearGuestData).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
  })

  it("取り込めなかったものが 1 件でもあれば、ゲストのデータは全部残す（次のログインで送り直す）", async () => {
    state.items = [guestItem()]
    state.mutateAsync.mockResolvedValue(result(1))
    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(guestData.clearGuestData).not.toHaveBeenCalled()
    expect(localStorage.getItem(SKIPPED_KEY)).toBe("1")
  })

  it("同じログインの間（merge 済みの印がある）は、再読み込みしても merge しない", async () => {
    state.items = [guestItem()]
    localStorage.setItem(MERGE_KEY, "true")
    renderProvider()
    await waitFor(() => expect(screen.getByTestId("completed")).toHaveTextContent("true"))
    expect(state.mutateAsync).not.toHaveBeenCalled()
  })

  it("merge が例外で失敗したら、ゲストのデータは消さず、印も付けない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.items = [guestItem()]
    state.mutateAsync.mockRejectedValue(new Error("network"))
    renderProvider()
    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId("completed")).toHaveTextContent("false"))
    expect(guestData.clearGuestData).not.toHaveBeenCalled()
    expect(localStorage.getItem(MERGE_KEY)).toBeNull()
  })
})

describe("ゲストに戻ったとき（ログアウト・セッション切れ）", () => {
  it("merge 済みの印と選んでいたグループを消す（次のログインで、ゲストのデータがあれば merge する）", async () => {
    state.user = null
    localStorage.setItem(MERGE_KEY, "true")
    localStorage.setItem("data-merge-completed-user-2", "true")
    localStorage.setItem("selectedGroupId", "group-1")
    renderProvider()
    await waitFor(() => expect(localStorage.getItem(MERGE_KEY)).toBeNull())
    expect(localStorage.getItem("data-merge-completed-user-2")).toBeNull()
    expect(localStorage.getItem("selectedGroupId")).toBeNull()
    expect(state.mutateAsync).not.toHaveBeenCalled()
  })

  it("認証の読み込み中は、ゲストとみなさず印を消さない", async () => {
    state.user = null
    state.isLoading = true
    localStorage.setItem(MERGE_KEY, "true")
    renderProvider()
    await new Promise((r) => setTimeout(r, 20))
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
  })
})
