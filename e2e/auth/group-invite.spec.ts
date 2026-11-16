import { test, expect } from "@playwright/test"
import { seedGroup, getUser, skipDataMerge, testUUID } from "./fixtures/db-helpers"
import { USER_A_EMAIL, USER_B_EMAIL, USER_B_STORAGE } from "./fixtures/auth-helpers"

test.describe("招待システム (G-6〜G-11)", () => {
  test.describe.configure({ mode: "serial" })

  let userA: { id: string; name: string; email: string }
  let userB: { id: string; name: string; email: string }

  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
    userB = await getUser(USER_B_EMAIL)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await skipDataMerge(page, userA.id)
  })

  test("G-6: 招待コードが表示される", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "招待テスト",
      ownerUserId: userA.id,
      inviteCode: "G6CODE",
    })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // 招待コードが表示される
    await expect(page.getByTestId("group-invite-code")).toContainText("G6CODE")
  })

  test("G-7: 招待コードでグループに参加できる", async ({ browser }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "参加テスト",
      ownerUserId: userA.id,
      inviteCode: "G7JOIN",
    })

    // user-b で参加
    const context = await browser.newContext({ storageState: USER_B_STORAGE })
    const page = await context.newPage()
    await page.goto("/")
    await skipDataMerge(page, userB.id)

    await page.goto("/groups")

    // ログイン済みの確認
    await expect(page.getByTestId("group-join-button")).toBeVisible({ timeout: 15000 })

    // 参加ボタンをクリック
    await page.getByTestId("group-join-button").click()
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })

    // 招待コードを入力
    await page.getByTestId("group-join-code-input").fill("G7JOIN")

    // 参加
    await page.getByTestId("group-join-submit").click()

    // BottomSheetが閉じる
    await page.getByTestId("bottom-sheet").waitFor({ state: "hidden" })

    // グループ一覧に表示される
    await expect(page.getByText("参加テスト")).toBeVisible({ timeout: 10000 })

    await context.close()
  })

  test("G-8: オーナーが招待コードを再生成できる", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "再生成テスト",
      ownerUserId: userA.id,
      inviteCode: "G8ORIG",
    })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // 元のコードを確認
    await expect(page.getByTestId("group-invite-code")).toContainText("G8ORIG")

    // 再生成ボタンをクリック
    await page.getByTestId("group-invite-regenerate").click()

    // コードが変更される（G8ORIGではなくなる）
    await expect(page.getByTestId("group-invite-code")).not.toContainText("G8ORIG", { timeout: 10000 })
  })

  test("G-9: オーナーが招待を一時停止できる", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "停止テスト",
      ownerUserId: userA.id,
      inviteCode: "G9STOP",
    })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // 招待トグルをクリックして無効化
    const toggle = page.getByTestId("group-invite-toggle")
    await toggle.click()

    // トグルの状態が変わる（aria-checked="false"）
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 10000 })

    // 「招待が一時停止中です」テキストが表示される
    await expect(page.getByText("招待が一時停止中です")).toBeVisible()
  })

  test("G-10: 無効なコードでエラーが表示される", async ({ page }) => {
    await page.goto("/groups")

    // ログイン済みの確認
    await expect(page.getByTestId("group-join-button")).toBeVisible({ timeout: 15000 })

    // 参加ボタンをクリック
    await page.getByTestId("group-join-button").click()
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })

    // 無効なコードを入力
    await page.getByTestId("group-join-code-input").fill("XXXXXX")

    // 参加
    await page.getByTestId("group-join-submit").click()

    // エラーが表示される
    await expect(page.getByTestId("group-join-error")).toBeVisible({ timeout: 10000 })
  })

  test("G-11: 招待停止中はコードで参加できない", async ({ browser }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "停止中参加テスト",
      ownerUserId: userA.id,
      inviteCode: "G11STP",
      inviteEnabled: false,
    })

    // user-b で参加を試みる
    const context = await browser.newContext({ storageState: USER_B_STORAGE })
    const page = await context.newPage()
    await page.goto("/")
    await skipDataMerge(page, userB.id)

    await page.goto("/groups")

    // ログイン済みの確認
    await expect(page.getByTestId("group-join-button")).toBeVisible({ timeout: 15000 })

    // 参加ボタンをクリック
    await page.getByTestId("group-join-button").click()
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })

    // 招待コードを入力
    await page.getByTestId("group-join-code-input").fill("G11STP")

    // 参加
    await page.getByTestId("group-join-submit").click()

    // エラーが表示される（招待が無効化されている旨）
    await expect(page.getByTestId("group-join-error")).toBeVisible({ timeout: 10000 })

    await context.close()
  })
})

test.describe("招待コードの有効期限 (#67)", () => {
  test.describe.configure({ mode: "serial" })

  let userA: { id: string; name: string; email: string }
  let userB: { id: string; name: string; email: string }

  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
    userB = await getUser(USER_B_EMAIL)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await skipDataMerge(page, userA.id)
  })

  test("EXP-1: 有効期限内のコードは有効期限が表示される", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "期限内テスト",
      ownerUserId: userA.id,
      inviteCode: testUUID().slice(0, 8).toUpperCase(),
    })

    await page.goto(`/groups/${groupId}`)

    await expect(page.getByTestId("group-invite-expiry")).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId("group-invite-expired")).not.toBeVisible()
  })

  test("EXP-2: 期限切れのコードは期限切れと表示される", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "期限切れテスト",
      ownerUserId: userA.id,
      inviteCode: testUUID().slice(0, 8).toUpperCase(),
      inviteCodeExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })

    await page.goto(`/groups/${groupId}`)

    await expect(page.getByTestId("group-invite-expired")).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId("group-invite-expiry")).not.toBeVisible()
  })

  test("EXP-3: 期限切れのコードでは参加できない", async ({ browser }) => {
    const groupId = testUUID()
    const inviteCode = testUUID().slice(0, 8).toUpperCase()
    await seedGroup({
      groupId,
      groupName: "期限切れ参加テスト",
      ownerUserId: userA.id,
      inviteCode,
      inviteCodeExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })

    const context = await browser.newContext({ storageState: USER_B_STORAGE })
    try {
      const page = await context.newPage()
      await page.goto("/")
      await skipDataMerge(page, userB.id)
      await page.goto("/groups")

      await page.getByTestId("group-join-button").click()
      await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
      await page.getByTestId("group-join-code-input").fill(inviteCode)
      await page.getByTestId("group-join-submit").click()

      await expect(page.getByTestId("group-join-error")).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId("group-join-error")).toContainText("有効期限")
    } finally {
      await context.close()
    }
  })
})
