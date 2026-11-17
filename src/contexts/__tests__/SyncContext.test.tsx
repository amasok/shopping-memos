import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface FakeEngine {
  options: Record<string, unknown>
  snapshot: { lastSyncAt: Date | null }
  start: ReturnType<typeof vi.fn>
  sync: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  requestSync: ReturnType<typeof vi.fn>
  setOnline: ReturnType<typeof vi.fn>
}

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  isMergeCompleted: true,
  localFirst: false,
  engines: [] as FakeEngine[],
  push: vi.fn(),
  pull: vi.fn(),
}))

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock("@/contexts/DataMergeContext", () => ({ useDataMerge: () => ({ isMergeCompleted: state.isMergeCompleted }) }))
vi.mock("@/lib/featureFlags", () => ({ isLocalFirstEnabled: () => state.localFirst }))
vi.mock("@/lib/db/userDb", () => ({ getUserDb: (id: string) => ({ name: `db-${id}` }) }))
const client = { sync: { push: { mutate: state.push }, pull: { query: state.pull } } }
vi.mock("@/infrastructure/trpc/client", () => ({ trpc: { useUtils: () => ({ client }) } }))
vi.mock("@/infrastructure/sync/SyncEngine", () => ({
  SyncEngine: class {
    listeners = new Set<() => void>()
    snapshot = {
      isOnline: true, isSyncing: false, pendingCount: 3, failedCount: 1, lastSyncAt: null as Date | null, sessionExpired: false, clientTooOld: false,
    }
    start = vi.fn(async () => {})
    sync = vi.fn(async () => {})
    stop = vi.fn()
    requestSync = vi.fn()
    setOnline = vi.fn()
    constructor(public options: Record<string, unknown>) {
      state.engines.push(this as never)
    }
    getState = () => this.snapshot
    subscribe = (listener: () => void) => {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    }
  },
}))

import { RESUME_SYNC_INTERVAL_MS, SyncProvider, useSync } from "../SyncContext"

function Probe() {
  const sync = useSync()
  return (
    <div>
      <span data-testid="counts">{`${sync.pendingCount}/${sync.failedCount}/${sync.engine ? "on" : "off"}`}</span>
      <button onClick={() => void sync.sync()}>sync</button>
      <button onClick={() => sync.requestSync()}>request</button>
    </div>
  )
}

const renderProvider = () => render(<SyncProvider><Probe /></SyncProvider>)
const latest = () => state.engines.at(-1)!

beforeEach(() => {
  state.user = { id: "user-1" }
  state.isMergeCompleted = true
  state.localFirst = false
  state.engines = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe("SyncProvider", () => {
  it("ゲストでは同期エンジンを作らない", () => {
    state.user = null
    renderProvider()
    expect(state.engines).toHaveLength(0)
    expect(screen.getByTestId("counts")).toHaveTextContent("0/0/off")
  })

  it("merge が終わるまでは同期しない", () => {
    state.isMergeCompleted = false
    renderProvider()
    expect(state.engines).toHaveLength(0)
  })

  it("ログイン中はユーザーの DB で drain モードのエンジンを作り、起動時に同期する（フラグが false）", async () => {
    renderProvider()
    await vi.waitFor(() => expect(latest().sync).toHaveBeenCalledTimes(1))
    expect(latest().options).toMatchObject({ db: { name: "db-user-1" }, mode: "drain", lockName: "shopping-memos-sync-user-1" })
    expect(screen.getByTestId("counts")).toHaveTextContent("3/1/on")
  })

  it("フラグが true なら full モード（push → pull）", () => {
    state.localFirst = true
    renderProvider()
    expect(latest().options.mode).toBe("full")
  })

  it("transport は sync.push / sync.pull を呼ぶ", async () => {
    renderProvider()
    const transport = latest().options.transport as { push: (i: unknown) => unknown; pull: (i: unknown) => unknown }
    await transport.push({ protocolVersion: 1, operations: [] })
    await transport.pull({ protocolVersion: 1 })
    expect(state.push).toHaveBeenCalledWith({ protocolVersion: 1, operations: [] })
    expect(state.pull).toHaveBeenCalledWith({ protocolVersion: 1 })
  })

  it("online で同期し、offline で状態を変える", async () => {
    renderProvider()
    await vi.waitFor(() => expect(latest().sync).toHaveBeenCalledTimes(1))
    act(() => {
      window.dispatchEvent(new Event("offline"))
      window.dispatchEvent(new Event("online"))
    })
    expect(latest().setOnline.mock.calls).toEqual([[false], [true]])
    expect(latest().sync).toHaveBeenCalledTimes(2)
  })

  it("前面に戻ったら、前回の同期から 30 秒以上空いたときだけ同期する", async () => {
    renderProvider()
    await vi.waitFor(() => expect(latest().sync).toHaveBeenCalledTimes(1))
    const engine = latest()
    engine.snapshot.lastSyncAt = new Date(Date.now() - 1000)
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(engine.sync).toHaveBeenCalledTimes(1)
    engine.snapshot.lastSyncAt = new Date(Date.now() - RESUME_SYNC_INTERVAL_MS)
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(engine.sync).toHaveBeenCalledTimes(2)
  })

  it("手動の同期と書き込み後の同期をエンジンに渡す", async () => {
    renderProvider()
    await vi.waitFor(() => expect(latest().sync).toHaveBeenCalledTimes(1))
    act(() => screen.getByText("sync").click())
    act(() => screen.getByText("request").click())
    expect(latest().sync).toHaveBeenCalledTimes(2)
    expect(latest().requestSync).toHaveBeenCalledTimes(1)
  })

  it("ログアウトしたらエンジンを止める", () => {
    const view = renderProvider()
    const engine = latest()
    state.user = null
    view.rerender(<SyncProvider><Probe /></SyncProvider>)
    expect(engine.stop).toHaveBeenCalled()
    expect(screen.getByTestId("counts")).toHaveTextContent("0/0/off")
  })

  it("SyncProvider の外では useSync がエラーになる", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow("useSync must be used within a SyncProvider")
  })
})
