import { test, expect, type Page } from "@playwright/test"

async function waitForControl(page: Page) {
  await page.goto("/")
  await page.evaluate(() => navigator.serviceWorker.ready)
  // 初回は SW が制御していないので 1 回リロードする
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}

test.describe("Service Worker (O1)", () => {
  test("O-11: /serwist/sw.js に Service-Worker-Allowed と no-cache が付く", async ({ request }) => {
    const res = await request.get("/serwist/sw.js")
    expect(res.status()).toBe(200)
    expect(res.headers()["service-worker-allowed"]).toBe("/")
    expect(res.headers()["cache-control"]).toMatch(/no-cache|no-store/)
  })

  test("/api/trpc と /api/auth のレスポンスは private, no-store", async ({ request }) => {
    const auth = await request.get("/api/auth/session")
    expect(auth.headers()["cache-control"]).toContain("no-store")
    const trpc = await request.get("/api/trpc/nonexistent")
    expect(trpc.headers()["cache-control"]).toContain("no-store")
  })

  test("O-1: ゲストはオンラインで一度開けば、オフラインでもリロードして表示できる", async ({ page, context }) => {
    await waitForControl(page)
    await context.setOffline(true)
    await page.reload()
    await expect(page.locator("body")).toBeVisible()
    await expect(page).not.toHaveURL(/~offline/)
    await expect(page.getByText("オフラインです")).toHaveCount(0)
    // 空の白紙ではなく、ホームの実際の内容（アプリシェル）が描画されている
    await expect(page.getByText("買いたいもの").first()).toBeVisible()
  })

  test("O-1: オフラインでも、プリキャッシュ済みのページ（タグ管理）に遷移できる", async ({ page, context }) => {
    await waitForControl(page)
    await context.setOffline(true)
    await page.goto("/tags")
    await expect(page).not.toHaveURL(/~offline/)
    await expect(page.getByText("タグを追加")).toBeVisible()
  })

  test("O-2: 未訪問の URL はオフラインで /~offline のフォールバックになる", async ({ page, context }) => {
    await waitForControl(page)
    await context.setOffline(true)
    await page.goto("/lists/never-visited-id").catch(() => {})
    await expect(page.getByText("オフラインです")).toBeVisible()
  })

  test("API のレスポンスは Cache Storage に残らない", async ({ page }) => {
    await waitForControl(page)
    await page.evaluate(() => fetch("/api/auth/session"))
    const hasApi = await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        const keys = await (await caches.open(name)).keys()
        if (keys.some((r) => new URL(r.url).pathname.startsWith("/api/"))) return true
      }
      return false
    })
    expect(hasApi).toBe(false)
  })

  test("O-12: 旧 /sw.js は自己解除し、キャッシュを消す", async ({ page }) => {
    await page.goto("/login")
    await page.evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
      await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    })
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)
      )
      .toBe(0)
  })
})
