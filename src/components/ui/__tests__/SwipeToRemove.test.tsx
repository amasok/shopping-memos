import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { SwipeToRemove } from "../SwipeToDelete"

function swipe(el: HTMLElement, from: number, to: number) {
  fireEvent.touchStart(el, { touches: [{ clientX: from }] })
  fireEvent.touchMove(el, { touches: [{ clientX: to }] })
}

describe("SwipeToRemove", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("しきい値を超えて左にスワイプすると 200ms 後に onRemove を呼び、位置を戻す", () => {
    const onRemove = vi.fn()
    render(<SwipeToRemove onRemove={onRemove}><div>牛乳</div></SwipeToRemove>)
    const content = screen.getByText("牛乳").parentElement as HTMLElement
    swipe(content, 300, 100)
    fireEvent.touchEnd(content)
    expect(onRemove).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(content.style.transform).toBe("translateX(0px)")
  })

  it("スワイプ量は最大 150px に抑える", () => {
    render(<SwipeToRemove onRemove={() => {}}><div>牛乳</div></SwipeToRemove>)
    const content = screen.getByText("牛乳").parentElement as HTMLElement
    swipe(content, 500, 0)
    expect(content.style.transform).toBe("translateX(-150px)")
  })

  it("しきい値ちょうど（80px）では外れず、それを超えると外れる", () => {
    const onRemove = vi.fn()
    render(<SwipeToRemove onRemove={onRemove}><div>牛乳</div></SwipeToRemove>)
    const content = screen.getByText("牛乳").parentElement as HTMLElement
    swipe(content, 300, 220)
    fireEvent.touchEnd(content)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onRemove).not.toHaveBeenCalled()
    swipe(content, 300, 219)
    fireEvent.touchEnd(content)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it("threshold を指定するとそれが基準になる", () => {
    const onRemove = vi.fn()
    render(<SwipeToRemove onRemove={onRemove} threshold={30}><div>牛乳</div></SwipeToRemove>)
    const content = screen.getByText("牛乳").parentElement as HTMLElement
    swipe(content, 300, 260)
    fireEvent.touchEnd(content)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it("しきい値に届かなければ onRemove を呼ばず元に戻る", () => {
    const onRemove = vi.fn()
    render(<SwipeToRemove onRemove={onRemove}><div>牛乳</div></SwipeToRemove>)
    const content = screen.getByText("牛乳").parentElement as HTMLElement
    swipe(content, 300, 250)
    fireEvent.touchEnd(content)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onRemove).not.toHaveBeenCalled()
    expect(content.style.transform).toBe("translateX(0px)")
  })

  it("右方向のスワイプは無視する", () => {
    render(<SwipeToRemove onRemove={() => {}}><div>牛乳</div></SwipeToRemove>)
    const content = screen.getByText("牛乳").parentElement as HTMLElement
    swipe(content, 100, 300)
    expect(content.style.transform).toBe("translateX(0px)")
  })

  it("外すラベルを指定でき、引っ張ると表示される", () => {
    const { container } = render(<SwipeToRemove onRemove={() => {}} removeLabel="戻す"><div>牛乳</div></SwipeToRemove>)
    const action = container.querySelector(".bg-orange-500") as HTMLElement
    expect(action).toHaveTextContent("戻す")
    expect(action).toHaveClass("opacity-0")
    const content = screen.getByText("牛乳").parentElement as HTMLElement
    swipe(content, 300, 250)
    expect(action).toHaveClass("opacity-100")
  })
})
