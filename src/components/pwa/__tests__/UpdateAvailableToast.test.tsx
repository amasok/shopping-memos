import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { UpdateAvailableToast } from "../UpdateAvailableToast"

describe("UpdateAvailableToast", () => {
  it("メッセージを表示し、［更新］で onUpdate を呼ぶ", () => {
    const onUpdate = vi.fn()
    render(<UpdateAvailableToast onUpdate={onUpdate} />)
    expect(screen.getByText("新しいバージョンがあります")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "更新" }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})
