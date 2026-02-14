import { test, expect } from "@playwright/test"
import { seedGroup, getUser, skipDataMerge, testUUID } from "./fixtures/db-helpers"
import { USER_A_EMAIL } from "./fixtures/auth-helpers"

test.describe("グループCRUD (G-1〜G-4)", () => {
  test.describe.configure({ mode: "serial" })

  let userA: { id: string; name: string; email: string }

  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await skipDataMerge(page, userA.id)
  })

  test("G-1: グループを作成できる", async ({ page }) => {
    await page.goto("/groups")

    // ログイン済みの確認（作成ボタンが表示される）
    await expect(page.getByTestId("group-create-button")).toBeVisible({ timeout: 15000 })

    // 作成ボタンをクリック
    await page.getByTestId("group-create-button").click()

    // BottomSheetが表示される
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })

    // グループ名を入力
    await page.getByTestId("group-create-name-input").fill("テスト家族")

    // 作成ボタンをクリック
    await page.getByTestId("group-create-submit").click()

    // BottomSheetが閉じる
    await page.getByTestId("bottom-sheet").waitFor({ state: "hidden" })

    // グループ一覧に表示される
    await expect(page.getByTestId("groups-list")).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("テスト家族")).toBeVisible()
  })

  test("G-2: グループ一覧が表示される", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "表示テストグループ",
      ownerUserId: userA.id,
      inviteCode: "G2TEST",
    })

    await page.goto("/groups")

    // グループ一覧が表示される
    await expect(page.getByTestId("groups-list")).toBeVisible({ timeout: 15000 })
    await expect(page.getByText("表示テストグループ")).toBeVisible()
  })

  test("G-3: オーナーがグループ名を変更できる", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "変更前のグループ",
      ownerUserId: userA.id,
      inviteCode: "G3TEST",
    })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ（データロード完了の指標）
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // グループ名をクリックして編集モードに
    await page.getByTestId("group-name").click()

    // 名前を変更
    const nameInput = page.getByTestId("group-name-input")
    await nameInput.clear()
    await nameInput.fill("変更後のグループ")

    // 保存
    await page.getByTestId("group-name-save").click()

    // 変更が反映される
    await expect(page.getByTestId("group-name")).toContainText("変更後のグループ")
  })

  test("G-4: オーナーがグループを削除できる", async ({ page }) => {
    const groupId = testUUID()
    await seedGroup({
      groupId,
      groupName: "削除対象グループ",
      ownerUserId: userA.id,
      inviteCode: "G4TEST",
    })

    await page.goto(`/groups/${groupId}`)

    // メンバーセクションが表示されるまで待つ
    await expect(page.getByTestId("group-members-section")).toBeVisible({ timeout: 15000 })

    // メニューを開く
    await page.getByTestId("group-menu-button").click()

    // 削除オプションが表示されるのを待つ
    await page.getByTestId("group-menu-delete").waitFor({ state: "visible" })

    // 削除をクリック
    await page.getByTestId("group-menu-delete").click()

    // 確認ダイアログ
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
    await page.getByTestId("group-delete-confirm").click()

    // グループ一覧にリダイレクト
    await page.waitForURL("/groups", { timeout: 10000 })

    // tRPCキャッシュをクリアするためリロード
    await page.reload()

    // グループが一覧から消えている
    await expect(page.getByText("削除対象グループ")).not.toBeVisible({ timeout: 10000 })
  })

})
