import { describe, it, expect, vi, afterEach } from "vitest"
import {
  fetchVersionInfo,
  getClientRelease,
  isBelowMinRelease,
  parseVersionInfo,
} from "../version"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("強制更新の判定", () => {
  it("最低リリース番号を下回っていれば true", () => {
    expect(isBelowMinRelease(100, 200)).toBe(true)
  })
  it("同じ・上回っていれば false", () => {
    expect(isBelowMinRelease(200, 200)).toBe(false)
    expect(isBelowMinRelease(300, 200)).toBe(false)
  })
  it("minClientRelease が 0 以下なら強制しない", () => {
    expect(isBelowMinRelease(0, 0)).toBe(false)
    expect(isBelowMinRelease(100, -1)).toBe(false)
  })
  it("NEXT_PUBLIC_BUILD_TIME を数値で返し、未設定なら 0", () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "1700000000000")
    expect(getClientRelease()).toBe(1700000000000)
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "")
    expect(getClientRelease()).toBe(0)
  })
})

describe("/api/version の取得", () => {
  it("正しい形でなければ null", () => {
    expect(parseVersionInfo(null)).toBeNull()
    expect(parseVersionInfo({ buildTime: "1" })).toBeNull()
    expect(parseVersionInfo({ buildTime: 1, minClientRelease: 2 })).toEqual({
      buildTime: 1,
      minClientRelease: 2,
    })
  })
  it("オフライン（fetch 失敗）では null を返し、例外を投げない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")))
    await expect(fetchVersionInfo()).resolves.toBeNull()
  })
  it("HTTP エラーでは null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    await expect(fetchVersionInfo()).resolves.toBeNull()
  })
  it("成功時は VersionInfo を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ buildTime: 5, minClientRelease: 3 }),
      })
    )
    await expect(fetchVersionInfo()).resolves.toEqual({ buildTime: 5, minClientRelease: 3 })
  })
})
