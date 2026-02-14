import { test, expect } from "@playwright/test"
import {
  seedGroup,
  addGroupMember,
  seedItems,
  getUser,
  skipDataMerge,
  testUUID,
} from "./fixtures/db-helpers"
import { USER_A_EMAIL, USER_B_EMAIL, USER_B_STORAGE } from "./fixtures/auth-helpers"

test.describe("マルチユーザー (G-19〜G-20)", () => {
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

  test("G-19: 同一グループのアイテムを別ユーザーが閲覧できる", async ({ browser }) => {
    const groupId = testUUID()
    // グループを作成し、user-bをメンバーに追加
    await seedGroup({
      groupId,
      groupName: "共有テスト",
      ownerUserId: userA.id,
      inviteCode: "G19SHR",
    })
    await addGroupMember({ groupId, userId: userB.id })

    // user-aがアイテムを作成
    await seedItems({
      userId: userA.id,
      groupId,
      items: [{ id: testUUID(), name: "共有アイテムG19" }],
    })

    // user-b でアクセス
    const context = await browser.newContext({ storageState: USER_B_STORAGE })
    const page = await context.newPage()
    await page.goto("/")
    await skipDataMerge(page, userB.id)

    // グループモードに切替
    await page.evaluate((gid) => {
      localStorage.setItem("selectedGroupId", gid)
    }, groupId)
    await page.goto("/")

    // user-aが作成したアイテムが表示される
    await expect(page.getByText("共有アイテムG19")).toBeVisible({ timeout: 15000 })

    await context.close()
  })

  test("G-20: 別グループのアイテムは非表示", async ({ browser }) => {
    const groupIdA = testUUID()
    const groupIdB = testUUID()

    // グループ1: user-a, user-b 所属
    await seedGroup({
      groupId: groupIdA,
      groupName: "公開グループ",
      ownerUserId: userA.id,
      inviteCode: "G20GA",
    })
    await addGroupMember({ groupId: groupIdA, userId: userB.id })
    await seedItems({
      userId: userA.id,
      groupId: groupIdA,
      items: [{ id: testUUID(), name: "公開アイテム" }],
    })

    // グループ2: user-a のみ
    await seedGroup({
      groupId: groupIdB,
      groupName: "非公開グループ",
      ownerUserId: userA.id,
      inviteCode: "G20GB",
    })
    await seedItems({
      userId: userA.id,
      groupId: groupIdB,
      items: [{ id: testUUID(), name: "非公開アイテム" }],
    })

    // user-b でグループ1モードに切替
    const context = await browser.newContext({ storageState: USER_B_STORAGE })
    const page = await context.newPage()
    await page.goto("/")
    await skipDataMerge(page, userB.id)

    await page.evaluate((gid) => {
      localStorage.setItem("selectedGroupId", gid)
    }, groupIdA)
    await page.goto("/")

    // グループ1のアイテムは表示される
    await expect(page.getByText("公開アイテム")).toBeVisible({ timeout: 15000 })

    // グループ2のアイテムは非表示
    await expect(page.getByText("非公開アイテム")).not.toBeVisible()

    await context.close()
  })
})
