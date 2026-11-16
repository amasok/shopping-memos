import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"

/**
 * ログアウトしたら・ゲストに戻ったら、ログイン中だけの状態（merge 済みの印・選んでいたグループ）を消す
 */
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  isLoading: false,
  signOut: vi.fn(async () => {}),
  storageAtSignOut: {} as Record<string, string | null>,
}))

vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({ data: { user: { id: "user-1", name: "A", email: "a@example.com" } }, status: "authenticated" }),
  signIn: vi.fn(),
  signOut: state.signOut,
}))
vi.mock("@/infrastructure/trpc/client", () => ({
  trpc: { identity: { getGroups: { useQuery: () => ({ data: [], isLoading: false }) } } },
}))

import { AuthProvider, useAuth } from "../AuthContext"

beforeEach(() => {
  localStorage.clear()
  state.signOut.mockReset().mockImplementation(async () => {
    state.storageAtSignOut = {
      merge: localStorage.getItem("data-merge-completed-user-1"),
      group: localStorage.getItem("selectedGroupId"),
    }
  })
})

function LogoutButton() {
  const { logout } = useAuth()
  return <button onClick={() => void logout()}>logout</button>
}

describe("logout", () => {
  it("signOut の前に、merge 済みの印と選んでいたグループを消す", async () => {
    localStorage.setItem("data-merge-completed-user-1", "true")
    localStorage.setItem("selectedGroupId", "group-1")
    render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>
    )

    await act(async () => {
      screen.getByText("logout").click()
    })

    expect(state.signOut).toHaveBeenCalledTimes(1)
    expect(state.storageAtSignOut).toEqual({ merge: null, group: null })
  })
})

describe("GroupContext（ゲスト）", () => {
  it("ゲストのときに選んでいたグループが残っていたら、個人に戻す", async () => {
    vi.resetModules()
    vi.doMock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isLoading: false }) }))
    localStorage.setItem("selectedGroupId", "group-1")
    const { GroupProvider, useGroup } = await import("../GroupContext")
    function Probe() {
      const { selectedGroupId } = useGroup()
      return <span data-testid="group">{selectedGroupId ?? "personal"}</span>
    }
    render(
      <GroupProvider>
        <Probe />
      </GroupProvider>
    )
    expect(screen.getByTestId("group")).toHaveTextContent("personal")
    expect(localStorage.getItem("selectedGroupId")).toBe("undefined")
    vi.doUnmock("@/contexts/AuthContext")
  })
})
