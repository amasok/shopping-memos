import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

/**
 * 表示名の設定への誘導（#61 A4。design の D3）
 */
const state = vi.hoisted(() => ({
  auth: { user: null as null | { id: string; name: string; email: string }, status: "unauthenticated" },
  pathname: "/",
  replace: vi.fn(),
}))

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }))
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace }),
}))

import { OnboardingGate } from "../OnboardingGate"

beforeEach(() => {
  state.replace.mockReset()
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, search: "" } })
})

const newUser = { id: "u1", name: "", email: "a@example.com" }

describe("OnboardingGate", () => {
  it("新しいアドレスでログインすると表示名の設定に進む（ログインの前にいた画面を戻り先にする）", () => {
    state.auth = { user: newUser, status: "authenticated" }
    state.pathname = "/groups"
    render(<OnboardingGate />)
    expect(state.replace).toHaveBeenCalledWith("/onboarding?callbackUrl=%2Fgroups")
  })

  it("表示名を設定するまで、ほかの画面を開いても設定に戻る（クエリも戻り先に含める）", () => {
    state.auth = { user: newUser, status: "authenticated" }
    state.pathname = "/lists/detail"
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, search: "?id=l1" } })
    render(<OnboardingGate />)
    expect(state.replace).toHaveBeenCalledWith("/onboarding?callbackUrl=%2Flists%2Fdetail%3Fid%3Dl1")
  })

  it("ホームからなら、戻り先を付けない", () => {
    state.auth = { user: newUser, status: "authenticated" }
    state.pathname = "/"
    render(<OnboardingGate />)
    expect(state.replace).toHaveBeenCalledWith("/onboarding")
  })

  it.each(["/onboarding", "/~offline"])("%s では誘導しない", (path) => {
    state.auth = { user: newUser, status: "authenticated" }
    state.pathname = path
    render(<OnboardingGate />)
    expect(state.replace).not.toHaveBeenCalled()
  })

  it("表示名のあるユーザーは表示名の設定に進まない", () => {
    state.auth = { user: { ...newUser, name: "ママ" }, status: "authenticated" }
    state.pathname = "/groups"
    render(<OnboardingGate />)
    expect(state.replace).not.toHaveBeenCalled()
  })

  it.each(["loading", "unauthenticated"])("%s のときは誘導しない", (status) => {
    state.auth = { user: status === "loading" ? null : null, status }
    state.pathname = "/groups"
    render(<OnboardingGate />)
    expect(state.replace).not.toHaveBeenCalled()
  })
})
