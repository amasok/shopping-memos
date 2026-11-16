import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

const state = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))

vi.mock("@/contexts/DataMergeContext", () => ({
  useDataMerge: () => state.value,
}))

import { DataMergeStatus } from "../DataMergeStatus"

// jsdom の <dialog> は showModal / close を持たないことがあるので、開閉だけを再現する（ConfirmDialog 用）
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void }
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "")
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open")
  }
})

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

  it("［破棄する］は、件数と元に戻せないことを書いた確認を出し、確認したときだけ消す（#144）", () => {
    const discardSkipped = vi.fn(async () => {})
    const dismissSkipped = vi.fn()
    state.value = { ...base, skippedCount: 2, discardSkipped, dismissSkipped }
    render(<DataMergeStatus />)

    fireEvent.click(screen.getByTestId("merge-skipped-discard"))
    // まだ消さない
    expect(discardSkipped).not.toHaveBeenCalled()
    const dialog = screen.getByRole("dialog", { hidden: true })
    expect(dialog).toHaveTextContent("取り込めなかった 2 件を破棄します。元に戻せません。")

    fireEvent.click(within(dialog).getByRole("button", { name: "破棄する", hidden: true }))
    expect(discardSkipped).toHaveBeenCalledTimes(1)
    expect(dismissSkipped).not.toHaveBeenCalled()
  })

  it("確認で［キャンセル］を押したら、消さない（#144）", () => {
    const discardSkipped = vi.fn(async () => {})
    state.value = { ...base, skippedCount: 1, discardSkipped }
    render(<DataMergeStatus />)

    fireEvent.click(screen.getByTestId("merge-skipped-discard"))
    const dialog = screen.getByRole("dialog", { hidden: true })
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル", hidden: true }))

    expect(discardSkipped).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull()
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
