import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"

/**
 * ゲストのデータとログイン・ログアウト（offline-support.md「ゲストのデータとログイン・ログアウト」）
 */
const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  isLoading: false,
  sessionKnown: true,
  tags: [] as unknown[],
  items: [] as unknown[],
  mutateAsync: vi.fn(),
}))

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: state.user, isLoading: state.isLoading, sessionKnown: state.sessionKnown }),
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
const guestData = vi.hoisted(() => ({
  clearGuestData: vi.fn(async () => {}),
  applyMergeOutcome: vi.fn<(userId: string, outcome: unknown) => Promise<void>>(async () => {}),
  migrated: true,
  watchCallback: null as null | (() => void),
  watchGuestWrites: vi.fn(),
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
  // ゲストの DB への書き込みの見張りは guestData.test.ts で確かめる。ここでは呼ばれたかと、知らせたときの動きを見る
  watchGuestWrites: guestData.watchGuestWrites,
  // 以前の仕組みからの移行は guestData.test.ts で確かめる
  ensureGuestDataMigrated: async () => guestData.migrated,
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
  state.sessionKnown = true
  state.tags = defaultTags()
  state.items = []
  state.mutateAsync.mockReset().mockResolvedValue(result(0))
  guestData.clearGuestData.mockClear()
  guestData.applyMergeOutcome.mockClear()
  guestData.migrated = true
  guestData.watchCallback = null
  guestData.watchGuestWrites.mockReset().mockImplementation((cb: () => void) => {
    guestData.watchCallback = cb
    return () => {
      guestData.watchCallback = null
    }
  })
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

  /** applyMergeOutcome に渡した、残すもの（エンティティごとの ID） */
  const kept = () =>
    (guestData.applyMergeOutcome.mock.calls[0][1] as { keep: Record<string, string[]> }).keep

  it("全部取り込めたら、送ったものを全部ゲストの DB から消して（何も残さず）再読み込みする", async () => {
    const one = guestItem()
    state.items = [one]
    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(state.mutateAsync).toHaveBeenCalledTimes(1)
    expect(guestData.applyMergeOutcome).toHaveBeenCalledTimes(1)
    const [userId, outcome] = guestData.applyMergeOutcome.mock.calls[0] as [string, { sent: Record<string, string[]> }]
    expect(userId).toBe("user-1")
    expect(outcome.sent.items).toEqual([one.id])
    expect(kept()).toEqual({ tags: [], items: [], lists: [], listItems: [] })
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
  })

  it("取り込めなかったものだけを残す（notImported のチャンクの中での位置で特定する。#144）", async () => {
    const ok = guestItem()
    const ng = { ...guestItem(), name: "取り込めない", tagIds: ["tag-x"] }
    state.tags = [...defaultTags(), { id: "tag-x", name: "お気に入り", createdAt: NOW, updatedAt: NOW }]
    state.items = [ok, ng]
    state.mutateAsync.mockResolvedValue({
      ...result(1),
      mergeResult: { ...result(1).mergeResult, notImported: [{ entity: "items", requestIndex: 1 }] },
    })
    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())
    // 取り込めなかったアイテムと、それが参照しているタグだけを残す
    expect(kept()).toEqual({ tags: ["tag-x"], items: [ng.id], lists: [], listItems: [] })
    expect(localStorage.getItem(SKIPPED_KEY)).toBe("1")
  })

  it("notImported を返さない古いサーバーでは、取り込めなかったものがあれば、そのチャンクを全部残す（安全側）", async () => {
    const a = guestItem()
    const b = guestItem()
    state.items = [a, b]
    state.mutateAsync.mockResolvedValue(result(1))
    renderProvider()
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(kept().items.sort()).toEqual([a.id, b.id].sort())
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
    expect(guestData.applyMergeOutcome).not.toHaveBeenCalled()
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

  it("通信のエラーでセッションがわからないときは、ゲストとして出しても印と選んでいたグループを消さない", async () => {
    state.user = null
    state.sessionKnown = false
    localStorage.setItem(MERGE_KEY, "true")
    localStorage.setItem("selectedGroupId", "group-1")
    renderProvider()
    await new Promise((r) => setTimeout(r, 20))
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
    expect(localStorage.getItem("selectedGroupId")).toBe("group-1")
  })

  it("セッションがわからない間にゲストの DB へ書くと、merge 済みの印を消し、次にセッションが確かになったら merge する（#61 A3a）", async () => {
    // オフラインで開いたログイン中のユーザー（ゲストとして表示）
    state.user = null
    state.sessionKnown = false
    localStorage.setItem(MERGE_KEY, "true")
    localStorage.setItem("selectedGroupId", "group-1")
    const { rerender } = renderProvider()
    await waitFor(() => expect(guestData.watchGuestWrites).toHaveBeenCalled())

    // ゲストの DB に商品を作る
    state.items = [guestItem()]
    act(() => guestData.watchCallback?.())
    expect(localStorage.getItem(MERGE_KEY)).toBeNull()
    expect(localStorage.getItem("selectedGroupId")).toBe("group-1")

    // オンラインに戻り、セッションが確かになると、その商品を merge する
    state.user = { id: "user-1" }
    state.sessionKnown = true
    rerender(
      <DataMergeProvider>
        <Probe />
      </DataMergeProvider>
    )
    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalled())
    // 見張りはやめている
    expect(guestData.watchCallback).toBeNull()
  })

  it("セッションが確かなゲスト・ログイン中・読み込み中は、ゲストの DB の書き込みを見張らない", async () => {
    state.user = null
    state.sessionKnown = true
    const { unmount } = renderProvider()
    unmount()
    state.user = { id: "user-1" }
    renderProvider().unmount()
    state.user = null
    state.isLoading = true
    state.sessionKnown = false
    renderProvider()
    await new Promise((r) => setTimeout(r, 20))
    expect(guestData.watchGuestWrites).not.toHaveBeenCalled()
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

describe("以前の仕組みからの移行に失敗した読み込み", () => {
  it("ログイン中: merge せず（古いゲストのデータを送らない）、サーバーのデータを表示する", async () => {
    guestData.migrated = false
    state.items = [guestItem()]
    localStorage.setItem("data-merge-completed-user-2", "true")
    renderProvider()
    await waitFor(() => expect(screen.getByTestId("completed")).toHaveTextContent("true"))
    expect(state.mutateAsync).not.toHaveBeenCalled()
    expect(guestData.applyMergeOutcome).not.toHaveBeenCalled()
  })

  it("ゲスト: 以前の印を消さない（次の読み込みで移行をやり直すため）", async () => {
    guestData.migrated = false
    state.user = null
    localStorage.setItem(MERGE_KEY, "true")
    renderProvider()
    await new Promise((r) => setTimeout(r, 20))
    expect(localStorage.getItem(MERGE_KEY)).toBe("true")
  })
})
