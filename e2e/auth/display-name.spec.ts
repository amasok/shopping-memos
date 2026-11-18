import { test, expect, type Page } from "@playwright/test"
import { E2E_ORIGIN } from "../ports"
import { e2eHeaders } from "./fixtures/db-helpers"
import { loginWithOtp } from "./fixtures/auth-helpers"
import { trpcMutation } from "./fixtures/trpc-helpers"

/**
 * 初回の表示名の設定と、設定画面のアカウント欄（#61 A4。change 61-a4-display-name-account の specs）
 *
 * 表示名の設定の画面を確かめるテストは、ヘルパーを使わずに画面からログインする（ヘルパーは表示名を入れてしまう）
 */
test.use({ storageState: { cookies: [], origins: [] } })

let seq = 0
function uniqueEmail(label: string) {
  seq += 1
  return `name-${label}-${Date.now()}-${process.pid}-${seq}@e2e-test.local`
}

async function useOwnIp(page: Page) {
  seq += 1
  await page.setExtraHTTPHeaders({ "x-real-ip": `10.210.${process.pid % 250}.${(seq % 250) + 1}` })
}

/** 画面からコードを送ってログインする（表示名は入れない） */
async function loginFromScreen(page: Page, email: string) {
  await page.getByTestId("login-email").fill(email)
  await page.getByTestId("login-send-code").click()
  await expect(page.getByTestId("login-code-sent")).toContainText(email)
  let otp: string | null = null
  await expect
    .poll(async () => {
      const res = await page.request.get(`${E2E_ORIGIN}/api/test/otp?email=${encodeURIComponent(email)}`, {
        headers: e2eHeaders(),
      })
      otp = (await res.json()).otp
      return otp
    })
    .not.toBeNull()
  await page.getByTestId("login-otp").fill(otp!)
  await page.getByTestId("login-submit").click()
}

async function sessionUser(page: Page): Promise<{ name: string; email: string } | null> {
  const body = await page.request.get(`${E2E_ORIGIN}/api/auth/get-session`).then((r) => r.json())
  return body?.user ?? null
}

test.beforeEach(async ({ page }) => {
  await useOwnIp(page)
})

test("新しいアドレスでログインすると表示名の設定に進み、表示名を入れるとホームに移る", async ({ page }) => {
  const email = uniqueEmail("new")
  await page.goto("/login")
  await loginFromScreen(page, email)

  await page.waitForURL(/\/onboarding/)
  await expect(page.getByRole("heading", { name: "表示名を決めてください" })).toBeVisible()
  await expect(page.getByText("グループのメンバー一覧に表示されます。あとから設定で変えられます")).toBeVisible()

  // 空白だけは保存できない
  await page.getByTestId("display-name-input").fill("   ")
  await page.getByTestId("display-name-submit").click()
  await expect(page.getByTestId("display-name-error")).toHaveText("表示名を入力してください")

  await page.getByTestId("display-name-input").fill("はなこ")
  await page.getByTestId("display-name-submit").click()
  await page.waitForURL(`${E2E_ORIGIN}/`)
  expect((await sessionUser(page))?.name).toBe("はなこ")

  // 設定画面に表示名とメールアドレスが出る（メールアドレスを変える操作はない）
  await page.goto("/settings")
  await expect(page.getByTestId("account-name")).toHaveText("はなこ")
  await expect(page.getByTestId("account-email")).toHaveText(email)
  await expect(page.getByRole("button", { name: /メールアドレスを変更/ })).toHaveCount(0)
})

test("表示名を入れると、ログインの前にいた画面に移る", async ({ page }) => {
  const email = uniqueEmail("callback")
  await page.goto("/groups")
  await page.getByRole("button", { name: "ログイン" }).click()
  await page.waitForURL(/\/login\?callbackUrl=%2Fgroups/)
  await loginFromScreen(page, email)
  await page.waitForURL(/\/onboarding\?callbackUrl=%2Fgroups/)
  await page.getByTestId("display-name-input").fill("パパ")
  await page.getByTestId("display-name-submit").click()
  await page.waitForURL(`${E2E_ORIGIN}/groups`)
})

test("表示名を設定するまで、ほかの画面を開いても設定に戻る", async ({ page }) => {
  const email = uniqueEmail("gate")
  await page.goto("/login")
  await loginFromScreen(page, email)
  await page.waitForURL(/\/onboarding/)
  await page.goto("/settings")
  await page.waitForURL(/\/onboarding\?callbackUrl=%2Fsettings/)
  await expect(page.getByRole("heading", { name: "表示名を決めてください" })).toBeVisible()
})

test("表示名の設定の画面からログアウトできる", async ({ page }) => {
  const email = uniqueEmail("logout")
  await page.goto("/login")
  await loginFromScreen(page, email)
  await page.waitForURL(/\/onboarding/)
  await page.getByTestId("onboarding-logout").click()
  await page.waitForURL(`${E2E_ORIGIN}/`)
  expect(await sessionUser(page)).toBeNull()
  await expect(page.getByTestId("fab-add-item")).toBeVisible()
})

test("設定画面で表示名を変えるとグループのメンバー一覧に反映される", async ({ page }) => {
  const email = uniqueEmail("rename")
  await loginWithOtp(page, email, { displayName: "まえのなまえ" })
  const group = await trpcMutation<{ id: string }>(page.request, "identity.createGroup", { name: `家族-${Date.now()}` })

  await page.goto("/settings")
  await expect(page.getByTestId("account-name")).toHaveText("まえのなまえ")
  await page.getByTestId("change-display-name-button").click()
  await page.getByTestId("display-name-input").fill("あたらしいなまえ")
  await page.getByTestId("display-name-submit").click()
  await expect(page.getByTestId("account-name")).toHaveText("あたらしいなまえ")

  await page.goto(`/groups/${group.id}`)
  await expect(page.getByText("あたらしいなまえ")).toBeVisible()
})

test("すべての端末からログアウトすると、ほかの端末のセッションも使えなくなり、この端末はゲストに戻る", async ({
  page,
  browser,
}) => {
  test.slow() // 2 台目のログインは、同じアドレスへの再送の間隔（60 秒）を待つ
  const email = uniqueEmail("revoke")
  await loginWithOtp(page, email)

  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const otherPage = await other.newPage()
    await otherPage.setExtraHTTPHeaders({ "x-real-ip": `10.211.${process.pid % 250}.${(seq % 250) + 1}` })
    await loginWithOtp(otherPage, email)
    expect((await sessionUser(otherPage))?.email).toBe(email)

    await page.goto("/settings")
    await page.getByTestId("logout-all-devices-button").click()
    await expect(
      page.getByText("すべての端末からログアウトしますか？この端末も含めて、もう一度メールのコードでログインが必要になります")
    ).toBeVisible()
    await page.getByRole("button", { name: "ログアウトする" }).click()
    await page.waitForURL(`${E2E_ORIGIN}/`)

    // この端末はゲストに戻り、ログイン中だけの状態も消えている
    expect(await sessionUser(page)).toBeNull()
    expect(
      await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("data-merge-completed-")))
    ).toBe(false)
    // ほかの端末のセッションも使えない
    const res = await otherPage.request.get(
      `${E2E_ORIGIN}/api/trpc/identity.getGroups?input=${encodeURIComponent(JSON.stringify({ json: null }))}`
    )
    expect(res.status()).toBe(401)
  } finally {
    await other.close()
  }
})
