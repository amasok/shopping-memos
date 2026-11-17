import { render, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * DBProvider の準備（#183）: ゲストのデータの移行と初期タグの作成が終わってから isReady にする。
 * Dexie の liveQuery は最初の読み込みの途中の書き込みを拾わないので、一覧の最初の読み込みを移行の後にするため
 */
const state = vi.hoisted(() => ({
  calls: [] as string[],
  resolveMigration: null as null | ((ok: boolean) => void),
  failTags: false,
}))

vi.mock("../versionEvents", () => ({
  attachVersionHandlers: () => {},
  isDbBlocked: () => false,
  subscribeDbBlocked: () => () => {},
}))
vi.mock("../guestData", () => ({
  ensureGuestDataMigrated: () => {
    state.calls.push("migrate")
    return new Promise<boolean>((resolve) => {
      state.resolveMigration = (ok) => {
        state.calls.push("migrated")
        resolve(ok)
      }
    })
  },
}))
vi.mock("../tags", () => ({
  initializeDefaultTags: async () => {
    state.calls.push("tags")
    if (state.failTags) throw new Error("tags failed")
  },
}))

import { DBProvider, useDB } from "../provider"

const wrapper = ({ children }: { children: ReactNode }) => <DBProvider>{children}</DBProvider>

beforeEach(() => {
  state.calls = []
  state.resolveMigration = null
  state.failTags = false
})

describe("DBProvider の準備（#183）", () => {
  it("ゲストのデータの移行が終わるまで isReady にならず、終わってから初期タグを作る", async () => {
    const { result } = renderHook(() => useDB(), { wrapper })

    await waitFor(() => expect(state.calls).toEqual(["migrate"]))
    expect(result.current.isReady).toBe(false)

    state.resolveMigration!(true)

    await waitFor(() => expect(result.current.isReady).toBe(true))
    expect(state.calls).toEqual(["migrate", "migrated", "tags"])
  })

  it("移行に失敗しても初期タグを作って isReady にする（今と同じく、エラーでも続ける）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.failTags = true
    const { result } = renderHook(() => useDB(), { wrapper })

    await waitFor(() => expect(state.resolveMigration).not.toBeNull())
    state.resolveMigration!(false)

    await waitFor(() => expect(result.current.isReady).toBe(true))
  })

  it("準備の間も子は描画する（読み込み中の表示は各画面が出す）", () => {
    const { getByText } = render(<DBProvider><p>中身</p></DBProvider>)
    expect(getByText("中身")).toBeDefined()
  })
})
