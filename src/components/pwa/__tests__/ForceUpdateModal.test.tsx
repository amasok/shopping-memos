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
})
