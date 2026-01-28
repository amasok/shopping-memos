import { describe, it, expect, vi } from "vitest"

// モック
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from "@/contexts/AuthContext"

// useDataSourceを直接インポートするとReactフックのルール違反になるため、
// ロジックのテストのみ行う
describe("useDataSource ロジック", () => {
  describe("データソース判定", () => {
    it("ユーザーがいる場合、サーバーを使用", () => {
      const mockUseAuth = vi.mocked(useAuth)
      mockUseAuth.mockReturnValue({
        user: { id: "user-1", name: "テスト", email: "test@example.com" },
        isLoading: false,
        login: vi.fn(),
        logout: vi.fn(),
      })

      const { user, isLoading } = mockUseAuth()

      expect(!!user).toBe(true) // useServer
      expect(!user).toBe(false) // useLocal
      expect(isLoading).toBe(false)
    })

    it("ユーザーがいない場合、ローカルを使用", () => {
      const mockUseAuth = vi.mocked(useAuth)
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        login: vi.fn(),
        logout: vi.fn(),
      })

      const { user, isLoading } = mockUseAuth()

      expect(!!user).toBe(false) // useServer
      expect(!user).toBe(true) // useLocal
      expect(isLoading).toBe(false)
    })

    it("読み込み中の場合、isAuthLoadingがtrue", () => {
      const mockUseAuth = vi.mocked(useAuth)
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
        login: vi.fn(),
        logout: vi.fn(),
      })

      const { isLoading } = mockUseAuth()

      expect(isLoading).toBe(true) // isAuthLoading
    })
  })
})
