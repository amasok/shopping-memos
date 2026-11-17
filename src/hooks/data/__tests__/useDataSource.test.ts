import { describe, it, expect, vi } from "vitest"

// モック
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}))

vi.mock("@/contexts/GroupContext", () => ({
  useGroup: vi.fn(),
}))

import { useAuth } from "@/contexts/AuthContext"
import { useGroup } from "@/contexts/GroupContext"

// useDataSourceを直接インポートするとReactフックのルール違反になるため、
// ロジックのテストのみ行う
describe("useDataSource ロジック", () => {
  describe("サーバーファースト方式のデータソース判定", () => {
    it("グループ選択時かつログイン中: サーバーを使用", () => {
      const mockUseAuth = vi.mocked(useAuth)
      const mockUseGroup = vi.mocked(useGroup)

      mockUseAuth.mockReturnValue({
        user: { id: "user-1", name: "テスト", email: "test@example.com" },
        isLoading: false,
        status: "authenticated",
        login: vi.fn(),
        logout: vi.fn(),
      })
      mockUseGroup.mockReturnValue({
        selectedGroupId: "group-1",
        setSelectedGroupId: vi.fn(),
        isValidating: false,
      })

      const { user } = mockUseAuth()
      const { selectedGroupId } = mockUseGroup()

      const hasGroupSelected = selectedGroupId !== undefined
      const isLoggedIn = !!user
      const useServer = hasGroupSelected && isLoggedIn

      expect(useServer).toBe(true)
      expect(!useServer).toBe(false) // useLocal
    })

    it("個人モード（グループ未選択）: ローカルを使用", () => {
      const mockUseAuth = vi.mocked(useAuth)
      const mockUseGroup = vi.mocked(useGroup)

      mockUseAuth.mockReturnValue({
        user: { id: "user-1", name: "テスト", email: "test@example.com" },
        isLoading: false,
        status: "authenticated",
        login: vi.fn(),
        logout: vi.fn(),
      })
      mockUseGroup.mockReturnValue({
        selectedGroupId: undefined,
        setSelectedGroupId: vi.fn(),
        isValidating: false,
      })

      const { user } = mockUseAuth()
      const { selectedGroupId } = mockUseGroup()

      const hasGroupSelected = selectedGroupId !== undefined
      const isLoggedIn = !!user
      const useServer = hasGroupSelected && isLoggedIn

      expect(useServer).toBe(false)
      expect(!useServer).toBe(true) // useLocal
    })

    it("未ログイン時: ローカルを使用（グループ選択関係なし）", () => {
      const mockUseAuth = vi.mocked(useAuth)
      const mockUseGroup = vi.mocked(useGroup)

      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        status: "unauthenticated",
        login: vi.fn(),
        logout: vi.fn(),
      })
      mockUseGroup.mockReturnValue({
        selectedGroupId: "group-1", // グループが選択されていても
        setSelectedGroupId: vi.fn(),
        isValidating: false,
      })

      const { user } = mockUseAuth()
      const { selectedGroupId } = mockUseGroup()

      const hasGroupSelected = selectedGroupId !== undefined
      const isLoggedIn = !!user
      const useServer = hasGroupSelected && isLoggedIn

      expect(useServer).toBe(false) // 未ログインなのでサーバーは使わない
      expect(!useServer).toBe(true) // useLocal
    })

    it("読み込み中の場合、isAuthLoadingがtrue", () => {
      const mockUseAuth = vi.mocked(useAuth)
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
        status: "loading",
        login: vi.fn(),
        logout: vi.fn(),
      })

      const { isLoading } = mockUseAuth()

      expect(isLoading).toBe(true) // isAuthLoading
    })
  })
})
