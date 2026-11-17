import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"

/**
 * AuthContext（#61 A3a 4.1）: Better Auth の useSession を包み、status・login・logout を出す
 */
const state = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
  signOut: vi.fn(async () => {}),
  calls: [] as string[],
}))

vi.mock("@/infrastructure/auth/client", () => ({
  authClient: {
    useSession: () => state.session,
    signOut: state.signOut,
  },
}))
vi.mock("@/lib/db/guestData", () => ({
  ensureGuestDataMigrated: async () => true,
  clearLoginScopedState: () => state.calls.push("clear"),
}))

import { AuthProvider, useAuth } from "../AuthContext"

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  state.calls = []
  state.signOut.mockReset().mockImplementation(async () => {
    state.calls.push("signOut")
  })
  assign = vi.fn((url: string) => state.calls.push(`assign:${url}`))
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, pathname: "/lists/abc", search: "?tab=1", assign },
  })
})

function Probe() {
  const { user, status, isLoading, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="user">{user ? `${user.id}:${user.name}:${user.email}` : "none"}</span>
      <button onClick={() => void login()}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  )
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
}

describe("AuthContext", () => {
  it("読み込み中は loading", () => {
    state.session = { data: null, isPending: true, error: null }
    renderProbe()
    expect(screen.getByTestId("status")).toHaveTextContent("loading")
    expect(screen.getByTestId("loading")).toHaveTextContent("true")
  })

  it("セッションがあれば authenticated で、ユーザーを出す（name が空なら ''）", () => {
    state.session = { data: { user: { id: "u1", name: null, email: "a@example.com", image: null } }, isPending: false, error: null }
    renderProbe()
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated")
    expect(screen.getByTestId("user")).toHaveTextContent("u1::a@example.com")
  })

  it("セッションがなければ unauthenticated", () => {
    state.session = { data: null, isPending: false, error: null }
    renderProbe()
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated")
    expect(screen.getByTestId("user")).toHaveTextContent("none")
  })

  it.each([
    ["通信のエラー（ページを離れるときに切れた通信・オフライン）", new TypeError("Failed to fetch")],
    ["サーバーのエラー", { status: 500 }],
    ["rate limit", { status: 429 }],
  ])("%sでセッションがわからないときは、ゲストにせず loading のまま", (_label, error) => {
    state.session = { data: null, isPending: false, error }
    renderProbe()
    expect(screen.getByTestId("status")).toHaveTextContent("loading")
    expect(screen.getByTestId("loading")).toHaveTextContent("true")
  })

  it("401 ならログインしていない", () => {
    state.session = { data: null, isPending: false, error: { status: 401 } }
    renderProbe()
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated")
  })

  it("ログイン中に取り直しがエラーになっても、前のセッションのまま authenticated", () => {
    state.session = { data: { user: { id: "u1", name: "A", email: "a@example.com" } }, isPending: false, error: { status: 500 } }
    renderProbe()
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated")
  })

  it("login はログイン画面へ移り、今いる画面を戻り先にする", async () => {
    state.session = { data: null, isPending: false, error: null }
    renderProbe()
    await act(async () => screen.getByText("login").click())
    expect(assign).toHaveBeenCalledWith("/login?callbackUrl=%2Flists%2Fabc%3Ftab%3D1")
  })

  it("ログアウトするとゲストに戻り、保護されたデータが見えない（ログイン中だけの状態を消し、signOut して、ホームを読み込み直す）", async () => {
    state.session = { data: { user: { id: "u1", name: "A", email: "a@example.com" } }, isPending: false, error: null }
    renderProbe()
    await act(async () => screen.getByText("logout").click())
    expect(state.calls).toEqual(["clear", "signOut", "assign:/"])
  })
})
