import { test, expect, type Page } from "@playwright/test"
import { E2E_ORIGIN } from "../ports"
import { loginWithOtp } from "./fixtures/auth-helpers"
import { trpcQuery } from "./fixtures/trpc-helpers"

/**
 * セッションを確かめられない間（オフラインなど）に作ったものの merge（#61 A3a）
 *
 * セッションの取得が通信のエラーになると、画面はゲストとして表示される（ゲストの DB で動く）。その間に作った商品は、
 * セッションが確かになったときに merge で送られ、ログイン中の画面から見える（Auth.js のころと同じ）。
 * オフラインは get-session の失敗で再現する。Playwright のオフラインは Service Worker の通信に効かず、SW 経由の
 * get-session が成功してしまうので、このテストでは SW を止める（SW のオフラインは e2e/offline で確かめる）
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" })

async function hasMergeMark(page: Page): Promise<boolean> {
  return page
    .evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("data-merge-completed-")))
    .catch(() => false)
}

test("セッションを確かめられない間に作った商品は、セッションが確かになると merge されて見える", async ({ page }) => {
  const email = `session-unknown-${Date.now()}-${process.pid}@e2e-test.local`
  const name = `確かめられない間の商品-${Date.now()}`

  // 1. ログインして開き、merge 済み（初期タグだけ）になる
  await loginWithOtp(page, email)
  await page.goto("/")
  await expect.poll(() => hasMergeMark(page), { timeout: 30_000 }).toBe(true)

  // 2. セッションの取得が通信のエラーになる状態で開き直すと、ゲストとして表示される
  await page.route("**/api/auth/get-session", (route) => route.abort("internetdisconnected"))
  await page.reload()
  await expect(page.getByTestId("fab-add-item")).toBeVisible()

  // 3. ゲストとして商品を作ると（ゲストの DB に入る）、merge 済みの印が消える。選んでいたものの印以外は残す
  await page.getByTestId("fab-add-item").click()
  await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
  await page.getByTestId("item-name-input").fill(name)
  await page.getByTestId("item-add-close").click()
  await expect(page.getByTestId("item-list")).toContainText(name)
  await expect.poll(() => hasMergeMark(page)).toBe(false)

  // 4. セッションを確かめられるようになって開き直すと、merge され、サーバーにその商品がある
  await page.unroute("**/api/auth/get-session")
  await page.reload()
  await expect
    .poll(
      async () => {
        const items = await trpcQuery<Array<{ name: string }>>(page.request, "catalog.getItems", {
          searchText: name,
          includePurchased: true,
        })
        return items.filter((i) => i.name === name).length
      },
      { timeout: 30_000 }
    )
    .toBe(1)
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).origin).toBe(E2E_ORIGIN)
})
