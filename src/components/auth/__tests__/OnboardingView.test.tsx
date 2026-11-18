import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act, fireEvent } from "@testing-library/react"

/**
 * 表示名の設定の画面（#61 A4）
 */
const state = vi.hoisted(() => ({
  auth: {
    user: null as null | { id: string; name: string; email: string },
    status: "authenticated",
    refresh: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  },
  replace: vi.fn(),
  mutateAsync: vi.fn(async (input: { name: string }) => ({ name: input.name })),
}))

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }))
vi.mock("@/infrastructure/trpc/client", () => ({
  trpc: { identity: { updateProfile: { useMutation: () => ({ mutateAsync: state.mutateAsync, isPending: false }) } } },
}))

import { OnboardingView } from "../OnboardingView"

beforeEach(() => {
  state.auth.user = { id: "u1", name: "", email: "a@example.com" }
  state.auth.status = "authenticated"
  state.auth.refresh.mockReset().mockResolvedValue(undefined)
  state.auth.logout.mockReset().mockResolvedValue(undefined)
  state.replace.mockReset()
  state.mutateAsync.mockReset().mockImplementation(async (input) => ({ name: input.name }))
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, origin: "http://localhost:3000" },
  })
})

async function submit(name: string) {
  fireEvent.change(screen.getByTestId("display-name-input"), { target: { value: name } })
  await act(async () => {
    fireEvent.click(screen.getByTestId("display-name-submit"))
  })
}

describe("表示名の設定の画面", () => {
  it("承認済みの文言が出る", () => {
    render(<OnboardingView callbackUrl={null} />)
    expect(screen.getByRole("heading", { name: "表示名を決めてください" })).toBeInTheDocument()
    expect(screen.getByText("グループのメンバー一覧に表示されます。あとから設定で変えられます")).toBeInTheDocument()
    expect(screen.getByTestId("display-name-submit")).toHaveTextContent("はじめる")
    expect(screen.getByTestId("onboarding-logout")).toHaveTextContent("ログアウト")
  })

  it("空白だけの表示名は保存できない", async () => {
    render(<OnboardingView callbackUrl={null} />)
    await submit("   ")
    expect(state.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByTestId("display-name-error")).toHaveTextContent("表示名を入力してください")
  })

  it("50 文字を超える表示名は保存できない", async () => {
    render(<OnboardingView callbackUrl={null} />)
    await submit("あ".repeat(51))
    expect(state.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByTestId("display-name-error")).toHaveTextContent("表示名は 50 文字までです")
  })

  it("表示名を入れると保存し、セッションを取り直す", async () => {
    render(<OnboardingView callbackUrl="/groups" />)
    await submit(" パパ ")
    expect(state.mutateAsync).toHaveBeenCalledWith({ name: "パパ" })
    expect(state.auth.refresh).toHaveBeenCalledTimes(1)
  })

  it("保存に失敗したら文言を出す", async () => {
    state.mutateAsync.mockRejectedValueOnce(new Error("network"))
    render(<OnboardingView callbackUrl={null} />)
    await submit("パパ")
    expect(screen.getByTestId("display-name-error")).toHaveTextContent("保存できませんでした。もう一度お試しください")
    expect(state.auth.refresh).not.toHaveBeenCalled()
  })

  it("表示名を入れると、ログインの前にいた画面に移る（表示名が入ったら戻り先へ）", () => {
    state.auth.user = { id: "u1", name: "パパ", email: "a@example.com" }
    render(<OnboardingView callbackUrl="/groups" />)
    expect(state.replace).toHaveBeenCalledWith("/groups")
  })

  it("戻り先が別のサイトならホームに移る", () => {
    state.auth.user = { id: "u1", name: "パパ", email: "a@example.com" }
    render(<OnboardingView callbackUrl="//evil.example/" />)
    expect(state.replace).toHaveBeenCalledWith("/")
  })

  it("ログインしていない人が開いたらホームに移る", () => {
    state.auth.user = null
    state.auth.status = "unauthenticated"
    render(<OnboardingView callbackUrl={null} />)
    expect(state.replace).toHaveBeenCalledWith("/")
  })

  it("読み込み中は移らない", () => {
    state.auth.user = null
    state.auth.status = "loading"
    render(<OnboardingView callbackUrl={null} />)
    expect(state.replace).not.toHaveBeenCalled()
  })

  it("表示名の設定の画面からログアウトできる", async () => {
    render(<OnboardingView callbackUrl={null} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId("onboarding-logout"))
    })
    expect(state.auth.logout).toHaveBeenCalledTimes(1)
  })
})
