import { describe, it, expect, vi, afterEach } from "vitest"
import { isSwEnabled, unregisterAllServiceWorkers } from "../kill-switch"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("kill switch（段階 1）", () => {
  it("NEXT_PUBLIC_SW_ENABLED=false のとき無効になる", () => {
    vi.stubEnv("NEXT_PUBLIC_SW_ENABLED", "false")
    expect(isSwEnabled()).toBe(false)
  })

  it("未設定なら有効", () => {
    vi.stubEnv("NEXT_PUBLIC_SW_ENABLED", "")
    expect(isSwEnabled()).toBe(true)
  })

  it("全登録を解除し、sm- / serwist- のキャッシュだけを削除する", async () => {
    const unregister = vi.fn().mockResolvedValue(true)
    const del = vi.fn().mockResolvedValue(true)
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]),
      },
    })
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["sm-v1-pages", "serwist-precache-v2", "other"]),
      delete: del,
    })
    await unregisterAllServiceWorkers()
    expect(unregister).toHaveBeenCalledTimes(2)
    expect(del).toHaveBeenCalledWith("sm-v1-pages")
    expect(del).toHaveBeenCalledWith("serwist-precache-v2")
    expect(del).not.toHaveBeenCalledWith("other")
  })
})
