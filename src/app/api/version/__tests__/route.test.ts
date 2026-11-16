// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest"
import { GET } from "../route"

afterEach(() => vi.unstubAllEnvs())

describe("GET /api/version", () => {
  it("buildTime と minClientRelease を返し、キャッシュしない", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "1700000000000")
    vi.stubEnv("MIN_CLIENT_RELEASE", "1600000000000")
    const res = GET()
    expect(await res.json()).toEqual({
      buildTime: 1700000000000,
      minClientRelease: 1600000000000,
    })
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("MIN_CLIENT_RELEASE が未設定なら 0（強制しない）", async () => {
    vi.stubEnv("MIN_CLIENT_RELEASE", "")
    expect((await GET().json()).minClientRelease).toBe(0)
  })

  it("MIN_CLIENT_RELEASE が数値でなければ 0", async () => {
    vi.stubEnv("MIN_CLIENT_RELEASE", "abc")
    expect((await GET().json()).minClientRelease).toBe(0)
  })
})
