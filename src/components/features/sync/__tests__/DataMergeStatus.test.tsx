import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const state = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))

vi.mock("@/contexts/DataMergeContext", () => ({
  useDataMerge: () => state.value,
}))

import { DataMergeStatus } from "../DataMergeStatus"

const base = {
  isMerging: false,
  isMergeCompleted: true,
  error: null,
  mergedCounts: null,
  retryMerge: vi.fn(),
  skippedCount: 0,
  dismissSkipped: vi.fn(),
  discardSkipped: vi.fn(async () => {}),
}

describe("DataMergeStatus: 取り込めなかったデータの通知 (#86)", () => {
  it("取り込めなかった件数があれば「n 件のデータは取り込めませんでした」を出す", () => {
    state.value = { ...base, skippedCount: 3 }
    render(<DataMergeStatus />)
    expect(screen.getByTestId("merge-skipped-notice")).toHaveTextContent(
      "3件のデータは取り込めませんでした",
    )
  })

  it("［破棄する］で、取り込めなかったデータを消す処理を呼ぶ（［閉じる］は呼ばない）(#144)", () => {
    const discardSkipped = vi.fn(async () => {})
    const dismissSkipped = vi.fn()
    state.value = { ...base, skippedCount: 2, discardSkipped, dismissSkipped }
    render(<DataMergeStatus />)
    fireEvent.click(screen.getByTestId("merge-skipped-discard"))
    expect(discardSkipped).toHaveBeenCalledTimes(1)
    expect(dismissSkipped).not.toHaveBeenCalled()
  })

  it("取り込めなかったデータは次のログインで送り直すことを、通知で伝える (#144)", () => {
    state.value = { ...base, skippedCount: 1 }
    render(<DataMergeStatus />)
    expect(screen.getByTestId("merge-skipped-notice")).toHaveTextContent("次のログインでもう一度送ります")
  })

  it("［閉じる］で通知を閉じる処理を呼ぶ", () => {
    const dismissSkipped = vi.fn()
    state.value = { ...base, skippedCount: 1, dismissSkipped }
    render(<DataMergeStatus />)
    fireEvent.click(screen.getByTestId("merge-skipped-dismiss"))
    expect(dismissSkipped).toHaveBeenCalledTimes(1)
  })

  it("件数が 0 なら何も出さない", () => {
    state.value = { ...base, skippedCount: 0 }
    const { container } = render(<DataMergeStatus />)
    expect(container).toBeEmptyDOMElement()
  })

  it("マージ中は、件数の通知ではなく同期中の表示を出す", () => {
    state.value = { ...base, isMerging: true, skippedCount: 2 }
    render(<DataMergeStatus />)
    expect(screen.queryByTestId("merge-skipped-notice")).toBeNull()
    expect(screen.getByText("データを同期中...")).toBeInTheDocument()
  })
})
