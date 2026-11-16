import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isLoading: false }),
}))
vi.mock("@/lib/db", () => ({
  db: {
    items: { toArray: async () => [] },
    tags: { toArray: async () => [] },
    lists: { toArray: async () => [] },
    listItems: { toArray: async () => [] },
  },
}))
vi.mock("@/infrastructure/trpc/client", () => ({
  trpc: { sync: { merge: { useMutation: () => ({ mutateAsync: vi.fn() }) } } },
}))

// merge の後にゲストのデータを消す処理は、この疑似 DB では呼び出しだけを記録する
const guestData = vi.hoisted(() => ({ clearGuestData: vi.fn(async () => {}) }))
vi.mock("@/lib/db/guestData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/guestData")>()),
  clearGuestData: guestData.clearGuestData,
}))

import { DataMergeProvider, useDataMerge } from "../DataMergeContext"

const SKIPPED_KEY = "data-merge-skipped-user-1"

function Probe() {
  const { skippedCount, dismissSkipped } = useDataMerge()
  return (
    <div>
      <span data-testid="skipped">{skippedCount}</span>
      <button onClick={dismissSkipped}>dismiss</button>
    </div>
  )
}

const renderProvider = () =>
  render(
    <DataMergeProvider>
      <Probe />
    </DataMergeProvider>
  )

beforeEach(() => {
  localStorage.clear()
  // マージ済みにして、このテストでは merge を実行させない
  localStorage.setItem("data-merge-completed-user-1", "true")
})

describe("DataMergeContext の取り込めなかった件数の通知 (#86)", () => {
  it("保存された件数を、リロード後（マウント時）に読み出す", () => {
    localStorage.setItem(SKIPPED_KEY, "3")

    renderProvider()

    expect(screen.getByTestId("skipped")).toHaveTextContent("3")
  })

  it("保存がなければ 0（通知しない）", () => {
    renderProvider()

    expect(screen.getByTestId("skipped")).toHaveTextContent("0")
  })

  it.each([["abc"], ["-2"], ["0"], [""]])("不正な値 %j は 0 として扱う", (value) => {
    localStorage.setItem(SKIPPED_KEY, value)

    renderProvider()

    expect(screen.getByTestId("skipped")).toHaveTextContent("0")
  })

  it("閉じると件数が 0 になり、保存も消える（次のリロードでも出ない）", () => {
    localStorage.setItem(SKIPPED_KEY, "2")
    renderProvider()

    fireEvent.click(screen.getByText("dismiss"))

    expect(screen.getByTestId("skipped")).toHaveTextContent("0")
    expect(localStorage.getItem(SKIPPED_KEY)).toBeNull()
  })

  it("別のユーザーの保存は読まない", () => {
    localStorage.setItem("data-merge-skipped-user-2", "5")

    renderProvider()

    expect(screen.getByTestId("skipped")).toHaveTextContent("0")
  })
})
