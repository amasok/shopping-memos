// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * playwright.config.ts のポートとサーバーの起動方法（#142）。
 * 環境変数を変えて設定を読み直し、解決された値を確かめる
 */

type WebServer = { command: string; url: string; reuseExistingServer: boolean }
type Config = {
  use: { baseURL: string }
  projects: { name: string; use?: { baseURL?: string } }[]
  webServer: WebServer[]
}

const ENV_KEYS = ["CI", "E2E_PORT", "E2E_OFFLINE_PORT", "E2E_START", "E2E_REUSE_SERVER", "E2E_OFFLINE"] as const

async function loadConfig(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<Config> {
  for (const key of ENV_KEYS) vi.stubEnv(key, env[key] ?? "")
  vi.resetModules()
  return (await import("../../playwright.config")).default as unknown as Config
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("playwright.config.ts のポート (#142)", () => {
  it("既定は従来どおり 3000、offline は 3100", async () => {
    const config = await loadConfig({ E2E_OFFLINE: "true" })

    expect(config.use.baseURL).toBe("http://localhost:3000")
    expect(config.projects.find((p) => p.name === "offline")?.use?.baseURL).toBe("http://localhost:3100")
    expect(config.webServer.map((s) => s.url)).toEqual(["http://localhost:3100", "http://localhost:3000"])
    expect(config.webServer[0].command).toContain("npx next start -p 3100")
  })

  it("E2E_PORT・E2E_OFFLINE_PORT で、baseURL とサーバーのポートを変えられる", async () => {
    const config = await loadConfig({ E2E_PORT: "43123", E2E_OFFLINE_PORT: "43124", E2E_OFFLINE: "true" })

    expect(config.use.baseURL).toBe("http://localhost:43123")
    expect(config.projects.find((p) => p.name === "offline")?.use?.baseURL).toBe("http://localhost:43124")
    const [offline, main] = config.webServer
    expect(offline.url).toBe("http://localhost:43124")
    expect(offline.command).toContain("-p 43124")
    expect(main.url).toBe("http://localhost:43123")
    expect(main.command).toContain("-p 43123")
  })

  it.each([["abc"], ["80"], ["70000"], ["3000.5"]])("不正な E2E_PORT（%s）は読み込み時にエラーにする", async (port) => {
    await expect(loadConfig({ E2E_PORT: port })).rejects.toThrow("E2E_PORT")
  })
})

describe("playwright.config.ts のサーバーの起動方法 (#142)", () => {
  const mainServer = (config: Config) => config.webServer[config.webServer.length - 1]

  it("手元の既定は dev サーバーで、既存のサーバーを使い回す", async () => {
    const server = mainServer(await loadConfig({}))

    expect(server.command).toBe("E2E_BUILD=true E2E_TEST=true npm run dev -- -p 3000")
    expect(server.reuseExistingServer).toBe(true)
  })

  it("CI は本番ビルド（npm run start）で、使い回さない", async () => {
    const server = mainServer(await loadConfig({ CI: "true" }))

    expect(server.command).toBe("E2E_TEST=true npm run start -- -p 3000")
    expect(server.reuseExistingServer).toBe(false)
  })

  it("scripts/e2e-local.sh の設定（E2E_START=true・E2E_REUSE_SERVER=false）では、本番ビルドを使い、ほかのサーバーを使い回さない", async () => {
    const config = await loadConfig({ E2E_START: "true", E2E_REUSE_SERVER: "false", E2E_PORT: "43123", E2E_OFFLINE: "true" })

    expect(mainServer(config).command).toBe("E2E_TEST=true npm run start -- -p 43123")
    for (const server of config.webServer) expect(server.reuseExistingServer).toBe(false)
  })
})
