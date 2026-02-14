import { test, expect } from "@playwright/test"
import {
  seedGroup,
  addGroupMember,
  getUser,
  skipDataMerge,
  testUUID,
} from "./fixtures/db-helpers"
import { USER_A_EMAIL, USER_B_EMAIL, USER_B_STORAGE } from "./fixtures/auth-helpers"

test.describe("メンバー管理 (G-12〜G-15)", () => {
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

  test("G-12: メンバー一覧が表示される（オーナーバッジ含む）", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "メンバーテスト",
      ownerUserId: userA.id,
      inviteCode: "G12MBR",
    })
    await addGroupMember({ groupId, userId: userB.id })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // 各メンバーが表示される
    await expect(page.getByTestId(`group-member-${userA.id}`)).toBeVisible()
    await expect(page.getByTestId(`group-member-${userB.id}`)).toBeVisible()

    // メンバー数の表示
    await expect(page.getByText("2人")).toBeVisible()
  })

  test("G-13: オーナーがメンバーを削除できる", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "削除テスト",
      ownerUserId: userA.id,
      inviteCode: "G13RMV",
    })
    await addGroupMember({ groupId, userId: userB.id })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // user-b のメンバー行が表示されるまで待つ
    await expect(page.getByTestId(`group-member-${userB.id}`)).toBeVisible()

    // メンバー削除ボタンをクリック
    await page.getByTestId("group-member-remove").click()

    // 確認ダイアログ
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
    await page.getByTestId("group-remove-member-confirm").click()

    // メンバーが削除される
    await page.getByTestId("bottom-sheet").waitFor({ state: "hidden" })
    await expect(page.getByTestId(`group-member-${userB.id}`)).not.toBeVisible({ timeout: 10000 })
  })

  test("G-14: メンバーがグループから退出できる", async ({ browser }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "退出テスト",
      ownerUserId: userA.id,
      inviteCode: "G14LVE",
    })
    await addGroupMember({ groupId, userId: userB.id })

    // user-b で退出
    const context = await browser.newContext({ storageState: USER_B_STORAGE })
    const page = await context.newPage()
    await page.goto("/")
    await skipDataMerge(page, userB.id)

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // メニューを開く
    await page.getByTestId("group-menu-button").click()

    // 退出をクリック
    await page.getByTestId("group-menu-leave").click()

    // 確認ダイアログ
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
    await page.getByTestId("group-leave-confirm").click()

    // グループ一覧にリダイレクト
    await page.waitForURL("/groups", { timeout: 15000 })

    // グループが一覧から消えている
    await expect(page.getByText("退出テスト")).not.toBeVisible()

    await context.close()
  })

  test("G-15: オーナーの削除ボタンは表示されない", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "保護テスト",
      ownerUserId: userA.id,
      inviteCode: "G15PRT",
    })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // オーナー自身のメンバー行が表示される
    await expect(page.getByTestId(`group-member-${userA.id}`)).toBeVisible()

    // メンバー削除ボタンが表示されていない（オーナーしかいないので0個）
    await expect(page.getByTestId("group-member-remove")).not.toBeVisible()
  })
})
