import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { BottomSheet } from "../BottomSheet"

describe("BottomSheet", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("閉じているときは何も描画しない", () => {
    render(<BottomSheet isOpen={false} onClose={() => {}}>中身</BottomSheet>)
    expect(screen.queryByTestId("bottom-sheet")).not.toBeInTheDocument()
  })

  it("開くとタイトルと中身を表示し、背面のスクロールを止める", () => {
    render(<BottomSheet isOpen onClose={() => {}} title="追加">中身</BottomSheet>)
    expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("追加")
    expect(screen.getByText("中身")).toBeInTheDocument()
    expect(document.body.style.overflow).toBe("hidden")
  })

  it("タイトルを省略しても描画できる", () => {
    render(<BottomSheet isOpen onClose={() => {}}>中身</BottomSheet>)
    expect(screen.getByTestId("bottom-sheet-title")).toHaveTextContent("")
  })

  it("閉じるボタンで onClose を呼ぶ", () => {
    const onClose = vi.fn()
    render(<BottomSheet isOpen onClose={onClose}>中身</BottomSheet>)
    fireEvent.click(screen.getByTestId("bottom-sheet-close"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("背景のクリックで閉じ、中身のクリックでは閉じない", () => {
    const onClose = vi.fn()
    render(<BottomSheet isOpen onClose={onClose}>中身</BottomSheet>)
    fireEvent.click(screen.getByText("中身"))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId("bottom-sheet"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("Escape で閉じ、ほかのキーでは閉じない", () => {
    const onClose = vi.fn()
    render(<BottomSheet isOpen onClose={onClose}>中身</BottomSheet>)
    fireEvent.keyDown(window, { key: "Enter" })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("閉じると 300ms 後に消え、スクロール防止も戻る", () => {
    const { rerender } = render(<BottomSheet isOpen onClose={() => {}}>中身</BottomSheet>)
    rerender(<BottomSheet isOpen={false} onClose={() => {}}>中身</BottomSheet>)
    expect(screen.getByTestId("bottom-sheet")).toBeInTheDocument()
    expect(document.body.style.overflow).toBe("")
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByTestId("bottom-sheet")).not.toBeInTheDocument()
  })
})
