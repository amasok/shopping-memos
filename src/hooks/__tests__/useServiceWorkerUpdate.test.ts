import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { Serwist } from "@serwist/window"
import { useServiceWorkerUpdate } from "../useServiceWorkerUpdate"

type Listener = (e: { isUpdate?: boolean }) => void

function createSerwist() {
  const listeners = new Map<string, Set<Listener>>()
  const serwist = {
    addEventListener: vi.fn((type: string, l: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(l)
    }),
    removeEventListener: vi.fn((type: string, l: Listener) => listeners.get(type)?.delete(l)),
    update: vi.fn().mockResolvedValue(undefined),
    messageSkipWaiting: vi.fn(),
  }
  const emit = (type: string, e: { isUpdate?: boolean } = {}) =>
    listeners.get(type)?.forEach((l) => l(e))
  return { serwist: serwist as unknown as Serwist, mock: serwist, emit }
}

const reload = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: vi.fn().mockResolvedValue(undefined), controller: null },
  })
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  })
  reload.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("useServiceWorkerUpdate", () => {
  it("waiting イベントで waiting が true になる", () => {
    const { serwist, emit } = createSerwist()
    const { result } = renderHook(() => useServiceWorkerUpdate(serwist))
    expect(result.current.waiting).toBe(false)
    act(() => emit("waiting"))
    expect(result.current.waiting).toBe(true)
  })

  it("applyUpdate で SKIP_WAITING を送る", () => {
    const { serwist, mock, emit } = createSerwist()
    const { result } = renderHook(() => useServiceWorkerUpdate(serwist))
    act(() => emit("waiting"))
    act(() => result.current.applyUpdate())
    expect(mock.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it("更新による controlling で 1 回だけリロードする", () => {
    const { serwist, emit } = createSerwist()
    renderHook(() => useServiceWorkerUpdate(serwist))
    act(() => emit("controlling", { isUpdate: true }))
    act(() => emit("controlling", { isUpdate: true }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("初回インストールの controlling ではリロードしない", () => {
    const { serwist, emit } = createSerwist()
    renderHook(() => useServiceWorkerUpdate(serwist))
    act(() => emit("controlling", { isUpdate: false }))
    expect(reload).not.toHaveBeenCalled()
  })

  it("前面に戻ったときと 1 時間ごとに update() を呼ぶ", () => {
    const { serwist, mock } = createSerwist()
    renderHook(() => useServiceWorkerUpdate(serwist))
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(mock.update).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000)
    })
    expect(mock.update).toHaveBeenCalledTimes(2)
  })

  it("アンマウントでリスナーとタイマーを解除する", () => {
    const { serwist, mock } = createSerwist()
    const { unmount } = renderHook(() => useServiceWorkerUpdate(serwist))
    unmount()
    expect(mock.removeEventListener).toHaveBeenCalledWith("waiting", expect.any(Function))
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    })
    expect(mock.update).not.toHaveBeenCalled()
  })

  it("serwist が null（開発環境など）でも例外を投げない", () => {
    const { result } = renderHook(() => useServiceWorkerUpdate(null))
    expect(result.current.waiting).toBe(false)
    expect(() => result.current.applyUpdate()).not.toThrow()
  })
})
