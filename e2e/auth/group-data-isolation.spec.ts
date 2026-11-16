import { test, expect } from "@playwright/test"
import {
  seedGroup,
  seedItems,
  getUser,
  skipDataMerge,
  testUUID,
} from "./fixtures/db-helpers"
import { USER_A_EMAIL, USER_B_EMAIL, USER_B_STORAGE } from "./fixtures/auth-helpers"
import { trpcQuery, trpcMutation } from "./fixtures/trpc-helpers"
import type { APIRequestContext } from "@playwright/test"

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

/**
 * #64 回帰: 買い物完了・履歴の差し戻し/削除が、同名の他ユーザー（他グループ）の
 * カタログアイテムに影響しないこと（実DB・実tRPC）
 */
test.describe("同名アイテムの影響範囲 (#64)", () => {
  test.describe.configure({ mode: "serial" })

  let userA: { id: string; name: string; email: string }
  let userB: { id: string; name: string; email: string }

  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
    userB = await getUser(USER_B_EMAIL)
  })

  type CatalogItem = { id: string; name: string; purchasedAt: string | null }

  const findItem = async (
    request: APIRequestContext,
    id: string,
    name: string,
    groupId?: string
  ): Promise<CatalogItem | undefined> => {
    const found = await trpcQuery<CatalogItem[]>(request, "catalog.getItems", {
      searchText: name,
      includePurchased: true,
      ...(groupId ? { groupId } : {}),
    })
    return found.find((i) => i.id === id)
  }

  /** リストを作成してアイテムをチェックし、買い物を完了する。履歴(リスト)IDを返す */
  const completeShopping = async (
    request: APIRequestContext,
    itemId: string,
    groupId?: string
  ): Promise<string> => {
    const list = await trpcMutation<{ id: string }>(request, "shopping.createList", {
      name: "回帰テスト",
      itemIds: [itemId],
      ...(groupId ? { groupId } : {}),
    })
    const listItems = await trpcQuery<Array<{ id: string }>>(request, "shopping.getListItems", {
      listId: list.id,
    })
    expect(listItems).toHaveLength(1)
    await trpcMutation(request, "shopping.checkItem", { listItemId: listItems[0].id, checked: true })
    await trpcMutation(request, "shopping.finishShopping", { listId: list.id })
    return list.id
  }

  /** 同名の個人アイテムを A と B に作成する */
  const seedSameNameItems = async (name: string) => {
    const aItem = testUUID()
    const bItem = testUUID()
    await seedItems({ userId: userA.id, items: [{ id: aItem, name }] })
    await seedItems({ userId: userB.id, items: [{ id: bItem, name }] })
    return { aItem, bItem }
  }

  test("ISO-1: A が買い物を完了しても、B の同名アイテムは購入済みにならない", async ({ page, browser }) => {
    const name = `共通牛乳1-${testUUID().slice(0, 8)}`
    const { aItem, bItem } = await seedSameNameItems(name)
    const bContext = await browser.newContext({ storageState: USER_B_STORAGE })

    await completeShopping(page.request, aItem)

    expect((await findItem(page.request, aItem, name))?.purchasedAt).not.toBeNull()
    const b = await findItem(bContext.request, bItem, name)
    expect(b).toBeDefined()
    expect(b?.purchasedAt).toBeNull()
    await bContext.close()
  })

  test("ISO-2: A が履歴を差し戻しても、B の購入済み同名アイテムは未購入に戻らない", async ({ page, browser }) => {
    const name = `共通牛乳2-${testUUID().slice(0, 8)}`
    const { aItem, bItem } = await seedSameNameItems(name)
    const bContext = await browser.newContext({ storageState: USER_B_STORAGE })
    // B 側も購入済みにしておく（差し戻しで巻き込まれないことを確認するため）
    await trpcMutation(bContext.request, "catalog.markItemAsPurchased", { id: bItem })

    const historyId = await completeShopping(page.request, aItem)
    await trpcMutation(page.request, "shopping.revertHistory", { historyId })

    expect((await findItem(page.request, aItem, name))?.purchasedAt).toBeNull()
    const b = await findItem(bContext.request, bItem, name)
    expect(b).toBeDefined()
    expect(b?.purchasedAt).not.toBeNull()
    await bContext.close()
  })

  test("ISO-3: A が履歴を削除しても、B の同名アイテムは削除されない", async ({ page, browser }) => {
    const name = `共通牛乳3-${testUUID().slice(0, 8)}`
    const { aItem, bItem } = await seedSameNameItems(name)
    const bContext = await browser.newContext({ storageState: USER_B_STORAGE })

    const historyId = await completeShopping(page.request, aItem)
    await trpcMutation(page.request, "shopping.deleteHistory", { id: historyId })

    expect(await findItem(page.request, aItem, name)).toBeUndefined()
    const b = await findItem(bContext.request, bItem, name)
    expect(b).toBeDefined()
    expect(b?.purchasedAt).toBeNull()
    await bContext.close()
  })

  test("ISO-4: グループリストの完了・削除は、同名の作成者の個人アイテムに影響しない", async ({ page }) => {
    const name = `共通牛乳4-${testUUID().slice(0, 8)}`
    const groupId = testUUID()
    await seedGroup({ groupId, groupName: "影響範囲テスト", ownerUserId: userA.id, inviteCode: "ISO4GR" })
    const groupItem = testUUID()
    const personalItem = testUUID()
    await seedItems({ userId: userA.id, groupId, items: [{ id: groupItem, name }] })
    await seedItems({ userId: userA.id, items: [{ id: personalItem, name }] })

    const historyId = await completeShopping(page.request, groupItem, groupId)

    expect((await findItem(page.request, groupItem, name, groupId))?.purchasedAt).not.toBeNull()
    expect((await findItem(page.request, personalItem, name))?.purchasedAt).toBeNull()

    await trpcMutation(page.request, "shopping.deleteHistory", { id: historyId })

    expect(await findItem(page.request, groupItem, name, groupId)).toBeUndefined()
    expect(await findItem(page.request, personalItem, name)).toBeDefined()
  })
})
