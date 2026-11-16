import { test, expect } from "@playwright/test"

/**
 * セキュリティヘッダ（#71）
 * - 全ルートにヘッダが付く
 * - 報告のみの CSP（Content-Security-Policy-Report-Only）に違反しない。強制へ切り替えられることの確認
 */

const EXPECTED = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
}

test.describe("セキュリティヘッダ", () => {
  for (const path of ["/", "/lists", "/settings", "/login", "/~offline"]) {
    test(`${path} にセキュリティヘッダが付く`, async ({ page }) => {
      const res = await page.goto(path)
      expect(res).not.toBeNull()
      const headers = res!.headers()
      for (const [key, value] of Object.entries(EXPECTED)) {
        expect(headers[key]).toBe(value)
      }
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'")
      expect(headers["content-security-policy-report-only"]).toContain("worker-src 'self'")
      expect(headers["permissions-policy"]).toContain("publickey-credentials-get=(self)")
      expect(headers["strict-transport-security"]).toContain("max-age=")
    })
  }

  test("API と SW のスクリプトにもヘッダが付き、SW 用のヘッダは残る", async ({ request }) => {
    const api = await request.get("/api/version")
    expect(api.headers()["x-content-type-options"]).toBe("nosniff")
    expect(api.headers()["x-frame-options"]).toBe("DENY")

    const sw = await request.get("/serwist/sw.js")
    expect(sw.headers()["x-content-type-options"]).toBe("nosniff")
    expect(sw.headers()["service-worker-allowed"]).toBe("/")
  })

  test("主要な画面で報告のみの CSP に違反しない", async ({ page }) => {
    // 報告のみのポリシーでも securitypolicyviolation イベントは発火する
    await page.addInitScript(() => {
      const w = window as unknown as { __cspViolations: string[] }
      w.__cspViolations = []
      document.addEventListener("securitypolicyviolation", (e) => {
        w.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`)
      })
    })

    for (const path of ["/", "/lists", "/lists/new", "/tags", "/history", "/settings", "/login"]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      const violations = await page.evaluate(
        () => (window as unknown as { __cspViolations: string[] }).__cspViolations
      )
      expect(violations, `${path} の CSP 違反`).toEqual([])
    }

    // 検出のしくみ自体が動くことの確認: http の画像は img-src で許可していない
    await page.evaluate(() => {
      const img = document.createElement("img")
      img.src = "http://example.invalid/csp-check.png"
      document.body.appendChild(img)
    })
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)
      )
      .toEqual([expect.stringContaining("img-src")])
  })
})
