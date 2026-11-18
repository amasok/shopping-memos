import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, act, fireEvent } from "@testing-library/react"

/**
 * 設定画面のアカウント欄の操作（#61 A4）
 */
const state = vi.hoisted(() => ({
  auth: {
    user: { id: "u1", name: "ママ", email: "mama@example.com" } as { id: string; name: string; email: string },
    refresh: vi.fn(async () => {}),
    logoutAllDevices: vi.fn(async () => {}),
  },
  mutateAsync: vi.fn(async (input: { name: string }) => ({ name: input.name })),
}))

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }))
vi.mock("@/infrastructure/trpc/client", () => ({
  trpc: { identity: { updateProfile: { useMutation: () => ({ mutateAsync: state.mutateAsync, isPending: false }) } } },
}))

import { AccountActions } from "../AccountActions"

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

beforeEach(() => {
  state.auth.refresh.mockReset().mockResolvedValue(undefined)
  state.auth.logoutAllDevices.mockReset().mockResolvedValue(undefined)
  state.mutateAsync.mockReset().mockImplementation(async (input) => ({ name: input.name }))
})

describe("設定画面のアカウント欄", () => {
  it("設定画面で表示名を変えられる（今の表示名から始め、保存したらシートを閉じる）", async () => {
    render(<AccountActions />)
    fireEvent.click(screen.getByTestId("change-display-name-button"))
    const input = screen.getByTestId("display-name-input")
    expect(input).toHaveValue("ママ")
    fireEvent.change(input, { target: { value: "おかあさん" } })
    await act(async () => {
      fireEvent.click(screen.getByTestId("display-name-submit"))
    })
    expect(state.mutateAsync).toHaveBeenCalledWith({ name: "おかあさん" })
    expect(state.auth.refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("display-name-input")).toBeNull()
  })

  it("表示名の変更でも、初回と同じ検証をする", async () => {
    render(<AccountActions />)
    fireEvent.click(screen.getByTestId("change-display-name-button"))
    fireEvent.change(screen.getByTestId("display-name-input"), { target: { value: "たろ‮う" } })
    await act(async () => {
      fireEvent.click(screen.getByTestId("display-name-submit"))
    })
    expect(state.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByTestId("display-name-error")).toHaveTextContent("使えない文字が含まれています")
  })

  it("すべての端末からログアウトの前に確認する", async () => {
    render(<AccountActions />)
    fireEvent.click(screen.getByTestId("logout-all-devices-button"))
    expect(
      screen.getByText("すべての端末からログアウトしますか？この端末も含めて、もう一度メールのコードでログインが必要になります")
    ).toBeInTheDocument()
    expect(state.auth.logoutAllDevices).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ログアウトする" }))
    })
    expect(state.auth.logoutAllDevices).toHaveBeenCalledTimes(1)
  })

  it("確認でキャンセルすると、すべての端末からログアウトしない", async () => {
    render(<AccountActions />)
    fireEvent.click(screen.getByTestId("logout-all-devices-button"))
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }))
    expect(state.auth.logoutAllDevices).not.toHaveBeenCalled()
  })
})
