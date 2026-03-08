import { test, expect } from "@playwright/test"
import {
  seedGroup,
  seedItems,
  getUser,
  skipDataMerge,
  testUUID,
} from "./fixtures/db-helpers"
import { USER_A_EMAIL } from "./fixtures/auth-helpers"

test.describe("データ分離 (G-16〜G-18)", () => {
  test.describe.configure({ mode: "serial" })

  let userA: { id: string; name: string; email: string }

  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await skipDataMerge(page, userA.id)
  })

  test("G-16: グループのアイテムは個人モードで非表示", async ({ page }) => {
    const groupId = testUUID()
    // グループとグループアイテムを作成
    await seedGroup({
      groupId,
      groupName: "分離テスト16",
      ownerUserId: userA.id,
      inviteCode: "G16ISO",
    })
    await seedItems({
      userId: userA.id,
      groupId,
      items: [{ id: testUUID(), name: "グループアイテムG16" }],
    })

    // 個人アイテムも作成
    await seedItems({
      userId: userA.id,
      items: [{ id: testUUID(), name: "個人アイテムG16" }],
    })

    // 個人モードでホームにアクセス（selectedGroupId を undefined にする）
    await page.evaluate(() => {
      localStorage.setItem("selectedGroupId", "undefined")
    })
    await page.goto("/")

    // 個人アイテムは表示される
    await expect(page.getByText("個人アイテムG16")).toBeVisible({ timeout: 15000 })

    // グループアイテムは非表示
    await expect(page.getByText("グループアイテムG16")).not.toBeVisible()
  })

  test("G-17: 個人アイテムはグループモードで非表示", async ({ page }) => {
    const groupId = testUUID()
    // グループとグループアイテムを作成
    await seedGroup({
      groupId,
      groupName: "分離テスト17",
      ownerUserId: userA.id,
      inviteCode: "G17ISO",
    })
    await seedItems({
      userId: userA.id,
      groupId,
      items: [{ id: testUUID(), name: "グループアイテムG17" }],
    })

    // 個人アイテムも作成
    await seedItems({
      userId: userA.id,
      items: [{ id: testUUID(), name: "個人アイテムG17" }],
    })

    // グループモードに切り替え
    await page.evaluate((gid) => {
      localStorage.setItem("selectedGroupId", gid)
    }, groupId)
    await page.goto("/")

    // グループアイテムは表示される
    await expect(page.getByText("グループアイテムG17")).toBeVisible({ timeout: 15000 })

    // 個人アイテムは非表示
    await expect(page.getByText("個人アイテムG17")).not.toBeVisible()
  })

  test("G-18: 異なるグループのアイテムは表示されない", async ({ page }) => {
    const groupIdA = testUUID()
    const groupIdB = testUUID()

    // グループAを作成
    await seedGroup({
      groupId: groupIdA,
      groupName: "分離グループA",
      ownerUserId: userA.id,
      inviteCode: "G18GA",
    })
    await seedItems({
      userId: userA.id,
      groupId: groupIdA,
      items: [{ id: testUUID(), name: "グループAアイテム" }],
    })

    // グループBを作成
    await seedGroup({
      groupId: groupIdB,
      groupName: "分離グループB",
      ownerUserId: userA.id,
      inviteCode: "G18GB",
    })
    await seedItems({
      userId: userA.id,
      groupId: groupIdB,
      items: [{ id: testUUID(), name: "グループBアイテム" }],
    })

    // グループAモードに切替
    await page.evaluate((gid) => {
      localStorage.setItem("selectedGroupId", gid)
    }, groupIdA)
    await page.goto("/")

    // グループAのアイテムは表示される
    await expect(page.getByText("グループAアイテム")).toBeVisible({ timeout: 15000 })

    // グループBのアイテムは非表示
    await expect(page.getByText("グループBアイテム")).not.toBeVisible()
  })
})
