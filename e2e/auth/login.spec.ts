import { test, expect, type Page } from "@playwright/test"
import { E2E_ORIGIN } from "../ports"
import { e2eHeaders } from "./fixtures/db-helpers"
import { trpcQuery } from "./fixtures/trpc-helpers"
import { seedTable } from "../fixtures/test-helpers"
import { createItem } from "../fixtures/test-data"

/**
 * メールのコードでのログイン（#61 A3a 5.3。change 61-a3-email-otp-login の specs）
 *
 * 画面からコードを送り、テスト用のルート（/api/test/otp）から読んだコードを入力してログインする。
 * 画面からのリクエストには x-real-ip が付かないので、テストごとに別の x-real-ip を付ける（IP ごとの上限を共有しない）
 */
test.use({ storageState: { cookies: [], origins: [] } })

let seq = 0
function uniqueEmail(label: string) {
  seq += 1
  return `login-${label}-${Date.now()}-${process.pid}-${seq}@e2e-test.local`
}

async function useOwnIp(page: Page) {
  seq += 1
  await page.setExtraHTTPHeaders({ "x-real-ip": `10.200.${process.pid % 250}.${(seq % 250) + 1}` })
}

async function latestOtp(page: Page, email: string): Promise<{ otp: string | null; sentAt: string | null }> {
  const res = await page.request.get(`${E2E_ORIGIN}/api/test/otp?email=${encodeURIComponent(email)}`, {
    headers: e2eHeaders(),
  })
  expect(res.ok()).toBe(true)
  return res.json()
}

/** 画面でコードを送り、届いたコードを返す */
async function sendCodeFromScreen(page: Page, email: string, previousSentAt: string | null = null): Promise<string> {
  await page.getByTestId("login-email").fill(email)
  await page.getByTestId("login-send-code").click()
  await expect(page.getByTestId("login-code-sent")).toContainText(email)
  return waitForNewOtp(page, email, previousSentAt)
}

async function waitForNewOtp(page: Page, email: string, previousSentAt: string | null): Promise<string> {
  let otp: string | null = null
  await expect
    .poll(async () => {
      const latest = await latestOtp(page, email)
      otp = latest.sentAt && latest.sentAt !== previousSentAt ? latest.otp : null
      return otp
    })
    .not.toBeNull()
  return otp!
}

async function enterCode(page: Page, otp: string) {
  await page.getByTestId("login-otp").fill(otp)
  await page.getByTestId("login-submit").click()
}

/** 新しいユーザーは、ログインの後に表示名の設定（#61 A4）を通る。表示名を入れて戻り先へ進む */
async function completeOnboarding(page: Page, name = "E2E ユーザー") {
  await page.waitForURL(/\/onboarding/)
  await page.getByTestId("display-name-input").fill(name)
  await page.getByTestId("display-name-submit").click()
}

/** 新しいユーザーとしてコードを入れ、表示名の設定を済ませる */
async function enterCodeAsNewUser(page: Page, otp: string) {
  await enterCode(page, otp)
  await completeOnboarding(page)
}

/** ゲストの DB の準備（以前の仕組みからの移行と初期タグ）が終わるまで待ってから、ゲストのデータを入れる */
async function seedGuestItem(page: Page, name: string) {
  await page.goto("/")
  await page.waitForFunction(() => localStorage.getItem("guest-data-version") === "2")
  await seedTable(page, "items", [createItem({ name })])
}

async function sessionEmail(page: Page): Promise<string | null> {
  const res = await page.request.get(`${E2E_ORIGIN}/api/auth/get-session`)
  const body = await res.json()
  return body?.user?.email ?? null
}

test.beforeEach(async ({ page }) => {
  await useOwnIp(page)
})

test("ログイン画面に Google のボタンがなく、移行の案内が出る", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByTestId("login-email")).toBeVisible()
  await expect(page.getByRole("button", { name: "コードを送信" })).toBeVisible()
  await expect(page.getByText(/Google\s*でログイン/)).toHaveCount(0)
  await expect(page.getByTestId("login-migration-notice")).toHaveText(
    "ログイン方法が変わりました。以前 Google で使っていた Gmail のアドレスを入力してください"
  )
})

test("新しいアドレスでログインすると、ホームに移り、そのアドレスでログインしている", async ({ page }) => {
  const email = uniqueEmail("new")
  await page.goto("/login")
  const otp = await sendCodeFromScreen(page, email)
  // 再送信は 60 秒たつまで押せない
  await expect(page.getByTestId("login-resend")).toBeDisabled()
  await enterCodeAsNewUser(page, otp)
  await page.waitForURL(`${E2E_ORIGIN}/`)
  expect(await sessionEmail(page)).toBe(email)
})

test("既存のユーザーでもう一度ログインできる（同じユーザーのまま）", async ({ page }) => {
  test.slow() // 同じアドレスへの 2 回目の送信は、再送の間隔（60 秒）を待つ
  const email = uniqueEmail("existing")
  await page.goto("/login")
  await enterCodeAsNewUser(page, await sendCodeFromScreen(page, email))
  await page.waitForURL(`${E2E_ORIGIN}/`)
  const first = await page.request.get(`${E2E_ORIGIN}/api/auth/get-session`).then((r) => r.json())

  await page.context().clearCookies()
  const { sentAt } = await latestOtp(page, email)
  await page.waitForTimeout(61_000)
  await page.goto("/login")
  await enterCode(page, await sendCodeFromScreen(page, email, sentAt))
  await page.waitForURL(`${E2E_ORIGIN}/`)
  const second = await page.request.get(`${E2E_ORIGIN}/api/auth/get-session`).then((r) => r.json())
  expect(second.user.id).toBe(first.user.id)
})

test("3 回まちがえるとコードが無効になり、60 秒たってから再送するとログインできる", async ({ page }) => {
  test.slow()
  const email = uniqueEmail("retry")
  await page.goto("/login")
  const otp = await sendCodeFromScreen(page, email)
  const wrong = otp === "000000" ? "111111" : "000000"

  for (let i = 0; i < 3; i++) {
    await enterCode(page, wrong)
    await expect(page.getByTestId("login-error")).toHaveText("コードが正しくありません")
  }
  await enterCode(page, otp)
  await expect(page.getByTestId("login-error")).toHaveText("コードの有効期限が切れました。再送信してください")

  const { sentAt } = await latestOtp(page, email)
  await expect(page.getByTestId("login-resend")).toBeEnabled({ timeout: 70_000 })
  await page.getByTestId("login-resend").click()
  const next = await waitForNewOtp(page, email, sentAt)
  await enterCodeAsNewUser(page, next)
  await page.waitForURL(`${E2E_ORIGIN}/`)
  expect(await sessionEmail(page)).toBe(email)
})

test("ログインの前にいた画面に戻る", async ({ page }) => {
  const email = uniqueEmail("callback")
  await page.goto("/groups")
  await page.getByRole("button", { name: "ログイン" }).click()
  await page.waitForURL(/\/login\?callbackUrl=%2Fgroups/)
  await enterCodeAsNewUser(page, await sendCodeFromScreen(page, email))
  await page.waitForURL(`${E2E_ORIGIN}/groups`)
})

for (const evil of ["https://evil.example/", "//evil.example/", "/\\evil.example", "/\t/evil.example"]) {
  test(`戻り先に別のサイトは指定できない（${JSON.stringify(evil)}）`, async ({ page }) => {
    const email = uniqueEmail("evil")
    await page.goto(`/login?callbackUrl=${encodeURIComponent(evil)}`)
    await enterCodeAsNewUser(page, await sendCodeFromScreen(page, email))
    await page.waitForURL(`${E2E_ORIGIN}/`)
    expect(new URL(page.url()).origin).toBe(E2E_ORIGIN)
  })
}

test("ログインするとゲストのデータが取り込まれる", async ({ page }) => {
  const email = uniqueEmail("merge")
  const name = `ゲストの商品-${Date.now()}`
  await seedGuestItem(page, name)
  await page.goto("/login")
  await enterCodeAsNewUser(page, await sendCodeFromScreen(page, email))
  await page.waitForURL(`${E2E_ORIGIN}/`)
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
  await expect(page.getByText(name)).toBeVisible()
})

test("ログアウトするとゲストに戻り、保護されたデータが見えない", async ({ page }) => {
  const email = uniqueEmail("logout")
  const name = `ログイン中の商品-${Date.now()}`
  await seedGuestItem(page, name)
  await page.goto("/login")
  await enterCodeAsNewUser(page, await sendCodeFromScreen(page, email))
  await page.waitForURL(`${E2E_ORIGIN}/`)
  await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 })

  await page.goto("/settings")
  await page.getByTestId("logout-button").click()
  await page.getByRole("button", { name: "ログアウト" }).last().click()
  await page.waitForURL(`${E2E_ORIGIN}/`)
  await page.waitForLoadState("networkidle")

  expect(await sessionEmail(page)).toBeNull()
  await expect(page.getByText(name)).toHaveCount(0)
  const res = await page.request.get(`${E2E_ORIGIN}/api/trpc/catalog.getItems?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`)
  expect(res.status()).toBe(401)
})

test("オフラインではコードを送れない", async ({ page, context }) => {
  await page.goto("/login")
  await expect(page.getByTestId("login-email")).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByTestId("login-offline")).toHaveText("オフラインのためログインできません")
  await expect(page.getByTestId("login-send-code")).toBeDisabled()
  await context.setOffline(false)
})

test("メールアドレスだけではログインできない", async ({ page }) => {
  const email = uniqueEmail("no-code")
  for (const data of [{ email }, { email, otp: "" }]) {
    const res = await page.request.post(`${E2E_ORIGIN}/api/auth/sign-in/email-otp`, {
      headers: { "content-type": "application/json", origin: E2E_ORIGIN },
      data,
    })
    expect(res.ok()).toBe(false)
  }
  expect(await sessionEmail(page)).toBeNull()
})
