import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import type { Serwist } from "@serwist/window"

const fetchVersionInfo = vi.fn()
vi.mock("@/lib/sw/version", async (orig) => ({
  ...(await orig<typeof import("@/lib/sw/version")>()),
  fetchVersionInfo: () => fetchVersionInfo(),
}))

import { ForceUpdateModal } from "../ForceUpdateModal"

const reload = vi.fn()

function mkSerwist() {
  return {
    update: vi.fn().mockResolvedValue(undefined),
    messageSkipWaiting: vi.fn(),
  }
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "100")
  sessionStorage.clear()
  reload.mockClear()
  fetchVersionInfo.mockReset()
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  })
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("ForceUpdateModal", () => {
  it("最低リリース番号以上ならモーダルを出さない", async () => {
    fetchVersionInfo.mockResolvedValue({
      buildTime: 100,
      minClientRelease: 100,
    })
    render(<ForceUpdateModal serwist={null} />)
    await waitFor(() => expect(fetchVersionInfo).toHaveBeenCalled())
    expect(screen.queryByTestId("force-update-modal")).toBeNull()
  })

  it("最低リリース番号がサーバーのビルドより新しい（設定ミス）ときは出さない", async () => {
    fetchVersionInfo.mockResolvedValue({ buildTime: 200, minClientRelease: 9999 })
    render(<ForceUpdateModal serwist={null} />)
    await waitFor(() => expect(fetchVersionInfo).toHaveBeenCalled())
    expect(screen.queryByTestId("force-update-modal")).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })

  it("取得に失敗（null）したら出さない", async () => {
    fetchVersionInfo.mockResolvedValue(null)
    render(<ForceUpdateModal serwist={null} />)
    await waitFor(() => expect(fetchVersionInfo).toHaveBeenCalled())
    expect(screen.queryByTestId("force-update-modal")).toBeNull()
  })

  it("下回っていれば閉じられないモーダルを出し、waiting の SW があれば SKIP_WAITING を送る", async () => {
    fetchVersionInfo.mockResolvedValue({
      buildTime: 200,
      minClientRelease: 200,
    })
    const s = mkSerwist()
    const postMessage = vi.fn()
    const addEventListener = vi.fn()
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi
          .fn()
          .mockResolvedValue({ waiting: { postMessage } }),
        addEventListener,
      },
    })
    render(<ForceUpdateModal serwist={s as unknown as Serwist} />)
    expect(await screen.findByTestId("force-update-modal")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }),
    )
    expect(addEventListener).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
      { once: true },
    )
    expect(s.update).toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it("waiting の SW がなければリロードし、1 分以内には繰り返さない", async () => {
    fetchVersionInfo.mockResolvedValue({
      buildTime: 200,
      minClientRelease: 200,
    })
    const { unmount } = render(
      <ForceUpdateModal serwist={mkSerwist() as unknown as Serwist} />,
    )
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    unmount()
    render(<ForceUpdateModal serwist={mkSerwist() as unknown as Serwist} />)
    await screen.findByTestId("force-update-modal")
    await new Promise((r) => setTimeout(r, 20))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  describe("serwist が null のとき（登録の完了前など）", () => {
    const forcedInfo = { buildTime: 200, minClientRelease: 200 }

    it("waiting の SW があれば、serwist が無くても SKIP_WAITING を直接送り、controllerchange でリロードする", async () => {
      fetchVersionInfo.mockResolvedValue(forcedInfo)
      const postMessage = vi.fn()
      let onControllerChange: (() => void) | undefined
      const addEventListener = vi.fn((type: string, cb: () => void) => {
        if (type === "controllerchange") onControllerChange = cb
      })
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistration: vi.fn().mockResolvedValue({ waiting: { postMessage } }),
          addEventListener,
        },
      })

      render(<ForceUpdateModal serwist={null} />)

      expect(await screen.findByTestId("force-update-modal")).toBeInTheDocument()
      await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }))
      expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function), {
        once: true,
      })
      // 有効になるまではリロードしない。有効になったらリロードする
      expect(reload).not.toHaveBeenCalled()
      onControllerChange?.()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it("waiting の SW がなければ、serwist が無くてもリロードし、1 分以内には繰り返さない", async () => {
      fetchVersionInfo.mockResolvedValue(forcedInfo)

      const { unmount } = render(<ForceUpdateModal serwist={null} />)
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
      expect(sessionStorage.getItem("sm-force-update-at")).not.toBeNull()
      unmount()

      render(<ForceUpdateModal serwist={null} />)
      await screen.findByTestId("force-update-modal")
      await new Promise((r) => setTimeout(r, 20))
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it("1 分以上前のリロードなら、再びリロードする", async () => {
      fetchVersionInfo.mockResolvedValue(forcedInfo)
      sessionStorage.setItem("sm-force-update-at", String(Date.now() - 61_000))

      render(<ForceUpdateModal serwist={null} />)

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    it("Service Worker が使えない環境でも、例外にならずリロードにフォールバックする", async () => {
      fetchVersionInfo.mockResolvedValue(forcedInfo)
      vi.stubGlobal("navigator", {})

      render(<ForceUpdateModal serwist={null} />)

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    it("serwist が後から渡されても、モーダルは 1 つのまま表示される", async () => {
      fetchVersionInfo.mockResolvedValue(forcedInfo)
      const postMessage = vi.fn()
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistration: vi.fn().mockResolvedValue({ waiting: { postMessage } }),
          addEventListener: vi.fn(),
        },
      })

      const { rerender } = render(<ForceUpdateModal serwist={null} />)
      await screen.findByTestId("force-update-modal")
      rerender(<ForceUpdateModal serwist={mkSerwist() as unknown as Serwist} />)

      await waitFor(() => expect(postMessage).toHaveBeenCalled())
      expect(screen.getAllByTestId("force-update-modal")).toHaveLength(1)
    })
  })
})
