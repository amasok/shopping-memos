import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useInstallPrompt } from "../useInstallPrompt"

describe("useInstallPrompt", () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: false }),
      writable: true,
    })

    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 Chrome/120",
      writable: true,
      configurable: true,
    })

    addEventListenerSpy = vi.spyOn(window, "addEventListener")
    removeEventListenerSpy = vi.spyOn(window, "removeEventListener")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("初期状態ではcanInstallがfalse", () => {
    const { result } = renderHook(() => useInstallPrompt())

    expect(result.current.canInstall).toBe(false)
    expect(result.current.isInstalled).toBe(false)
  })

  it("スタンドアロンモードではisInstalledがtrue", () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: true }),
      writable: true,
    })

    const { result } = renderHook(() => useInstallPrompt())

    expect(result.current.isInstalled).toBe(true)
  })

  it("beforeinstallpromptイベントでcanInstallがtrueになる", () => {
    const { result } = renderHook(() => useInstallPrompt())

    const handler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "beforeinstallprompt"
    )?.[1] as EventListener

    const mockEvent = new Event("beforeinstallprompt")
    mockEvent.preventDefault = vi.fn()
    act(() => {
      handler(mockEvent)
    })

    expect(result.current.canInstall).toBe(true)
    expect(mockEvent.preventDefault).toHaveBeenCalled()
  })

  it("appinstalledイベントでisInstalledがtrueになる", () => {
    const { result } = renderHook(() => useInstallPrompt())

    const handler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "appinstalled"
    )?.[1] as EventListener

    act(() => {
      handler(new Event("appinstalled"))
    })

    expect(result.current.isInstalled).toBe(true)
    expect(result.current.canInstall).toBe(false)
  })

  it("install()がプロンプトを表示し、承認後にisInstalledをtrueにする", async () => {
    const { result } = renderHook(() => useInstallPrompt())

    const mockPrompt = vi.fn().mockResolvedValue(undefined)
    const mockEvent = {
      preventDefault: vi.fn(),
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    }

    const handler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "beforeinstallprompt"
    )?.[1] as EventListener

    act(() => {
      handler(mockEvent as unknown as Event)
    })

    await act(async () => {
      await result.current.install()
    })

    expect(mockPrompt).toHaveBeenCalled()
    expect(result.current.isInstalled).toBe(true)
    expect(result.current.canInstall).toBe(false)
  })

  it("install()で拒否された場合はisInstalledがfalseのまま", async () => {
    const { result } = renderHook(() => useInstallPrompt())

    const mockEvent = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    }

    const handler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "beforeinstallprompt"
    )?.[1] as EventListener

    act(() => {
      handler(mockEvent as unknown as Event)
    })

    await act(async () => {
      await result.current.install()
    })

    expect(result.current.isInstalled).toBe(false)
  })

  it("iOSデバイスではisIOSがtrueになる", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useInstallPrompt())

    expect(result.current.isIOS).toBe(true)
  })

  it("アンマウント時にイベントリスナーが解除される", () => {
    const { unmount } = renderHook(() => useInstallPrompt())

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "beforeinstallprompt",
      expect.any(Function)
    )
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "appinstalled",
      expect.any(Function)
    )
  })
})
