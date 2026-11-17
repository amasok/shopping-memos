// @vitest-environment node
import { readFileSync } from "fs"
import path from "path"
import { describe, it, expect } from "vitest"
import {
  PERMISSIONS_POLICY,
  buildEnforcedCsp,
  buildReportOnlyCsp,
  buildSecurityHeaders,
} from "../headers"

/** "a b; c d" → { a: ["b"], c: ["d"] } */
function parseCsp(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/)
      return [name, values]
    })
  )
}

const headersOf = (isDev: boolean) =>
  Object.fromEntries(buildSecurityHeaders({ isDev }).map((h) => [h.key, h.value]))

describe("buildSecurityHeaders", () => {
  it("Issue #71 の各ヘッダを付ける", () => {
    const h = headersOf(false)
    expect(h["X-Frame-Options"]).toBe("DENY")
    expect(h["X-Content-Type-Options"]).toBe("nosniff")
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=63072000; includeSubDomains$/)
    expect(h["Permissions-Policy"]).toBe(PERMISSIONS_POLICY)
    expect(h["Content-Security-Policy"]).toBe(buildEnforcedCsp())
    expect(h["Content-Security-Policy-Report-Only"]).toBe(buildReportOnlyCsp({ isDev: false }))
  })

  it("同じヘッダを重複して付けない", () => {
    const keys = buildSecurityHeaders({ isDev: false }).map((h) => h.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("強制する CSP", () => {
  const csp = parseCsp(buildEnforcedCsp())

  it("iframe への埋め込み（クリックジャッキング）を禁止する", () => {
    expect(csp["frame-ancestors"]).toEqual(["'none'"])
  })

  it("object と base 要素の悪用を防ぐ", () => {
    expect(csp["object-src"]).toEqual(["'none'"])
    expect(csp["base-uri"]).toEqual(["'self'"])
  })

  it("画面の読み込みに影響する指令（default-src・script-src 等）は強制しない", () => {
    for (const name of ["default-src", "script-src", "style-src", "img-src", "connect-src", "worker-src"]) {
      expect(csp[name]).toBeUndefined()
    }
  })
})

describe("報告のみの CSP", () => {
  const prod = parseCsp(buildReportOnlyCsp({ isDev: false }))
  const dev = parseCsp(buildReportOnlyCsp({ isDev: true }))

  it("既定は self だけ", () => {
    expect(prod["default-src"]).toEqual(["'self'"])
  })

  it("Service Worker を塞がない（worker-src 'self'）", () => {
    expect(prod["worker-src"]).toEqual(["'self'"])
  })

  it("OGP の外部画像（https）を読み込める", () => {
    expect(prod["img-src"]).toEqual(expect.arrayContaining(["'self'", "https:", "data:"]))
    expect(prod["img-src"]).not.toContain("http:")
    expect(prod["img-src"]).not.toContain("*")
  })

  it("本番では eval と WebSocket を許可しない", () => {
    expect(prod["script-src"]).not.toContain("'unsafe-eval'")
    expect(prod["connect-src"]).toEqual(["'self'"])
  })

  it("開発時だけ eval（React の開発ビルド）と ws:（HMR）を許可する", () => {
    expect(dev["script-src"]).toContain("'unsafe-eval'")
    expect(dev["connect-src"]).toContain("ws:")
  })

  it("Turnstile（#61 A3a）のスクリプトと iframe だけを外から許可する", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"])
    expect(prod["frame-src"]).toEqual(["https://challenges.cloudflare.com"])
  })

  it("埋め込み・フォーム送信先・object を制限する", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"])
    expect(prod["form-action"]).toEqual(["'self'"])
    expect(prod["object-src"]).toEqual(["'none'"])
    expect(prod["base-uri"]).toEqual(["'self'"])
  })
})

describe("Permissions-Policy", () => {
  const policy = Object.fromEntries(
    PERMISSIONS_POLICY.split(",").map((p) => p.trim().split("="))
  )

  it("カメラ・マイク・位置情報を止める", () => {
    expect(policy.camera).toBe("()")
    expect(policy.microphone).toBe("()")
    expect(policy.geolocation).toBe("()")
  })

  it("パスキー（WebAuthn）は self で許可し、塞がない", () => {
    expect(policy["publickey-credentials-get"]).toBe("(self)")
    expect(policy["publickey-credentials-create"]).toBe("(self)")
  })

  it("アプリが使うクリップボード・共有は制限しない", () => {
    expect(policy["clipboard-write"]).toBeUndefined()
    expect(policy["web-share"]).toBeUndefined()
  })
})

describe("next.config.ts", () => {
  it("全ルート（/:path*）にセキュリティヘッダを付ける", () => {
    const config = readFileSync(path.resolve(__dirname, "../../../../next.config.ts"), "utf-8")
    expect(config).toMatch(
      /source: "\/:path\*",\s*headers: buildSecurityHeaders\(\{ isDev: process\.env\.NODE_ENV === "development" \}\)/
    )
  })
})
