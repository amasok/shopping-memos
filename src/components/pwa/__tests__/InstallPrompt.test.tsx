import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { InstallPrompt } from "../InstallPrompt"

const mockInstall = vi.fn()
const mockUseInstallPrompt = vi.fn()

vi.mock("@/hooks/useInstallPrompt", () => ({
  useInstallPrompt: () => mockUseInstallPrompt(),
}))

describe("InstallPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("インストール済みの場合は何も表示しない", () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: false,
      isInstalled: true,
      isIOS: false,
      install: mockInstall,
    })

    const { container } = render(<InstallPrompt />)
    expect(container.firstChild).toBeNull()
  })

  it("インストール不可かつ非iOSの場合は何も表示しない", () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: false,
      isInstalled: false,
      isIOS: false,
      install: mockInstall,
    })

    const { container } = render(<InstallPrompt />)
    expect(container.firstChild).toBeNull()
  })

  it("canInstallがtrueの場合にインストールボタンを表示する", () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: false,
      isIOS: false,
      install: mockInstall,
    })

    render(<InstallPrompt />)

    expect(screen.getByText("アプリをインストール")).toBeInTheDocument()
    expect(screen.getByText("インストール")).toBeInTheDocument()
  })

  it("インストールボタンクリックでinstall()が呼ばれる", async () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: false,
      isIOS: false,
      install: mockInstall,
    })

    render(<InstallPrompt />)

    fireEvent.click(screen.getByText("インストール"))
    expect(mockInstall).toHaveBeenCalledOnce()
  })

  it("iOSの場合はホーム画面追加の手順を表示する", () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: false,
      isInstalled: false,
      isIOS: true,
      install: mockInstall,
    })

    render(<InstallPrompt />)

    expect(screen.getByText("ホーム画面に追加")).toBeInTheDocument()
    expect(
      screen.getByText((content) =>
        content.includes("共有ボタンから")
      )
    ).toBeInTheDocument()
  })
})
