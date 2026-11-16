import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { seedGroup, seedItems, getUser, skipDataMerge, testUUID } from "./fixtures/db-helpers"
import { USER_A_EMAIL, loginAndSaveState } from "./fixtures/auth-helpers"

/**
 * Preview で手で確かめていた項目の自動化（ログイン中のサーバーモード）
 *
 *  3  ログイン中も「追加して続ける」で入力が消えない
 *  4  リストを作り、チェックして「買い物終了」で履歴に残る
 *  5  履歴の「元に戻す」と「削除」
 *  7  画面から作ったグループの招待コードは 8 文字で、有効期限が出る
 *  8  別のアカウントがコードで参加でき、でたらめなコード・停止中・期限切れは同じ汎用のエラーになる
 *  9  グループのリストで、アイテムとタグを追加できる（メンバーにも見える）
 *
 * ほかのテストのデータと混ざらないよう、名前は毎回ユニークにし、参加する側のアカウントも毎回新しく作る
 * （招待コードの試行は 1 ユーザー 1 時間に 10 回までなので、固定の B は使わない）
 */

const suffix = Date.now().toString(36)
const name = (label: string) => `${label}-${suffix}`
const INVITE_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/

let userA: { id: string }

/** 個人モード（グループを選んでいない）で、DataMerge をスキップして開く */
async function openPersonal(page: Page, userId: string) {
  await page.goto("/")
  await skipDataMerge(page, userId)
  await page.evaluate(() => localStorage.setItem("selectedGroupId", "undefined"))
  await page.goto("/")
}

/** グループモードで開く */
async function openGroup(page: Page, userId: string, groupId: string, path = "/") {
  await page.goto("/")
  await skipDataMerge(page, userId)
  await page.evaluate((gid) => localStorage.setItem("selectedGroupId", gid), groupId)
  await page.goto(path)
}

/** 新しいアカウントでログインしたコンテキストを作る（招待コードの参加用） */
async function newLoggedInContext(browser: Browser, label: string): Promise<{ context: BrowserContext; page: Page; userId: string }> {
  const storagePath = `e2e/.auth/checklist-${label}-${suffix}.json`
  const setup = await browser.newContext()
  const setupPage = await setup.newPage()
  const userId = await loginAndSaveState(setupPage, `checklist-${label}-${suffix}@e2e-test.local`, storagePath)
  await setup.close()
  const context = await browser.newContext({ storageState: storagePath })
  const page = await context.newPage()
  return { context, page, userId }
}

/** 名前を指定して、既存のアイテムを選んでリストを作り、リスト詳細（/lists/detail?id=）に遷移する */
async function createListFrom(page: Page, itemNames: string[]) {
  await page.goto("/lists/new")
  await page.getByTestId("existing-items-list").waitFor({ state: "visible", timeout: 15000 })
  for (const n of itemNames) {
    await page.getByTestId("existing-items-list").locator("label").filter({ hasText: n }).click()
  }
  await page.getByTestId("item-selector-submit").click()
  await expect(page).toHaveURL(/\/lists\/detail\?id=/, { timeout: 15000 })
  await page.getByTestId("unchecked-section").waitFor({ state: "visible", timeout: 15000 })
}

/** 全アイテムをチェックして「買い物終了」し、履歴（/history）に遷移する */
async function checkAllAndComplete(page: Page) {
  const labels = page.getByTestId("unchecked-list").locator("label")
  const count = await labels.count()
  for (let i = 0; i < count; i++) {
    await labels.first().click()
    await expect(page.getByTestId("unchecked-list").locator("label")).toHaveCount(count - i - 1)
  }
  await page.getByTestId("complete-button").click()
  await expect(page).toHaveURL(/\/history/, { timeout: 15000 })
}

test.describe("Preview 確認項目（ログイン中）", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    userA = await getUser(USER_A_EMAIL)
  })

  test("#3: ログイン中も「追加して続ける」で入力が消えず、連続で追加できる", async ({ page }) => {
    const names = [name("続1"), name("続2"), name("続3")]
    await openPersonal(page, userA.id)

    await page.getByTestId("fab-add-item").click()
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
    for (let i = 0; i < names.length; i++) {
      await page.getByTestId("item-name-input").fill(names[i])
      if (i < names.length - 1) {
        await page.getByTestId("item-add-continue").click()
        // 保存が終わってフォームがリセットされる（次の入力が消えないよう、リセットを待ってから入力する）
        await expect(page.getByTestId("item-name-input")).toHaveValue("")
      } else {
        await page.getByTestId("item-add-close").click()
      }
    }
    await expect(page.getByTestId("bottom-sheet")).toBeHidden()

    for (const n of names) {
      await expect(page.getByTestId("item-list")).toContainText(n)
    }
  })

  test("#4: リストを作り、チェックして「買い物終了」すると履歴に残る", async ({ page }) => {
    const names = [name("買い物1"), name("買い物2")]
    await seedItems({ userId: userA.id, items: names.map((n) => ({ id: testUUID(), name: n })) })
    await openPersonal(page, userA.id)
    await createListFrom(page, names)
    // 履歴の id はリストの id。ほかのテストの履歴と区別するため、控える
    const listId = new URL(page.url()).searchParams.get("id")!

    await checkAllAndComplete(page)

    const record = page.getByTestId(`history-item-${listId}`)
    await expect(record).toContainText("2点")
    await record.locator("button").first().click()
    for (const n of names) {
      await expect(record).toContainText(n)
    }
  })

  test("#5: 履歴の「リストに戻す」で、リストが戻り、アイテムが見える", async ({ page }) => {
    const names = [name("戻す1")]
    await seedItems({ userId: userA.id, items: names.map((n) => ({ id: testUUID(), name: n })) })
    await openPersonal(page, userA.id)
    await createListFrom(page, names)
    // 他のテストが作ったリストと区別するため、このリストの ID を控える
    const listId = new URL(page.url()).searchParams.get("id")!
    await checkAllAndComplete(page)

    const record = page.getByTestId(`history-item-${listId}`)
    await record.locator("button").first().click()
    await record.locator("button", { hasText: "リストに戻す" }).click()

    await expect(page).toHaveURL(/\/lists/, { timeout: 15000 })
    // 戻したリストが一覧にあり、開くとアイテムが入っている
    await page.getByTestId(`list-item-${listId}`).click()
    await expect(page).toHaveURL(new RegExp(`/lists/detail\\?id=${listId}`))
    await expect(page.getByText(names[0])).toBeVisible()
  })

  test("#5: 履歴の「削除」で、その履歴だけが消える", async ({ page }) => {
    const names = [name("削除1")]
    await seedItems({ userId: userA.id, items: names.map((n) => ({ id: testUUID(), name: n })) })
    await openPersonal(page, userA.id)
    await createListFrom(page, names)
    const listId = new URL(page.url()).searchParams.get("id")!
    await checkAllAndComplete(page)

    const record = page.getByTestId(`history-item-${listId}`)
    await expect(record).toBeVisible()
    await record.locator("button").first().click()
    await record.locator("[data-testid^='history-delete-']").click()
    await page.getByTestId("history-delete-confirm").click()

    await expect(page.getByTestId(`history-item-${listId}`)).toHaveCount(0)
  })

  /** グループ（画面から作る）。#7・#8・#9 で共有する */
  const group: { id: string; name: string; code: string } = { id: "", name: name("確認グループ"), code: "" }

  test("#7: 画面から作ったグループの招待コードは 8 文字で、有効期限が表示される", async ({ page }) => {
    await page.goto("/")
    await skipDataMerge(page, userA.id)
    await page.goto("/groups")
    await page.getByTestId("group-create-button").click()
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
    await page.getByTestId("group-create-name-input").fill(group.name)
    await page.getByTestId("group-create-submit").click()
    await page.getByTestId("bottom-sheet").waitFor({ state: "hidden" })

    await page.getByTestId("groups-list").locator("li").filter({ hasText: group.name }).locator("a").click()
    await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}/)
    group.id = new URL(page.url()).pathname.split("/").pop()!

    const code = ((await page.getByTestId("group-invite-code").textContent()) ?? "").trim()
    expect(code).toMatch(INVITE_CODE)
    group.code = code
    await expect(page.getByTestId("group-invite-expiry")).toBeVisible()
    await expect(page.getByTestId("group-invite-expired")).toHaveCount(0)
  })

  test("#8: 別のアカウントがコードで参加でき、でたらめなコード・停止中・期限切れは同じ汎用のエラーになる", async ({ browser }) => {
    expect(group.code).toMatch(INVITE_CODE)
    const joiner = await newLoggedInContext(browser, "joiner")
    try {
      const { page, userId } = joiner
      await page.goto("/")
      await skipDataMerge(page, userId)
      await page.goto("/groups")

      const join = async (code: string) => {
        await page.getByTestId("group-join-code-input").fill(code)
        await page.getByTestId("group-join-submit").click()
      }
      const openSheet = async () => {
        await page.getByTestId("group-join-button").click()
        await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
      }

      // 停止中・期限切れのグループ（A が作ったもの）
      const disabledCode = testUUID().replace(/-/g, "").slice(0, 8).toUpperCase()
      const expiredCode = testUUID().replace(/-/g, "").slice(0, 8).toUpperCase()
      await seedGroup({ groupId: testUUID(), groupName: name("停止中"), ownerUserId: userA.id, inviteCode: disabledCode, inviteEnabled: false })
      await seedGroup({
        groupId: testUUID(),
        groupName: name("期限切れ"),
        ownerUserId: userA.id,
        inviteCode: expiredCode,
        inviteCodeExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })

      // でたらめ・停止中・期限切れは、どれも同じ汎用のエラー（コードの存在や状態が分からない）
      await expect(page.getByTestId("group-join-button")).toBeVisible({ timeout: 15000 })
      await openSheet()
      const messages: string[] = []
      for (const code of ["ZZZZ2345", disabledCode, expiredCode]) {
        await join(code)
        await expect(page.getByTestId("group-join-error")).toBeVisible({ timeout: 10000 })
        messages.push(((await page.getByTestId("group-join-error").textContent()) ?? "").trim())
        await page.getByTestId("group-join-code-input").fill("")
      }
      expect(messages[0]).toContain("無効")
      expect(messages[1]).toBe(messages[0])
      expect(messages[2]).toBe(messages[0])

      // 正しいコードで参加できる
      await join(group.code)
      await page.getByTestId("bottom-sheet").waitFor({ state: "hidden", timeout: 15000 })
      await expect(page.getByTestId("groups-list")).toContainText(group.name)
    } finally {
      await joiner.context.close()
    }
  })

  test("#9: グループのリストで、アイテムとタグを追加でき、メンバーにも見える", async ({ page, browser }) => {
    expect(group.id).not.toBe("")
    const tag = name("グループタグ")
    const first = name("グループ品1")
    const added = name("リスト内追加")

    // タグを作る（グループのタグ）
    await openGroup(page, userA.id, group.id, "/tags")
    await page.getByTestId("tag-add-button").click()
    await page.getByTestId("tag-name-input").fill(tag)
    await page.getByTestId("tag-add-submit").click()
    await expect(page.getByTestId("tag-list")).toContainText(tag)

    // そのタグを付けてアイテムを追加する
    await page.goto("/")
    await page.getByTestId("fab-add-item").click()
    await page.getByTestId("bottom-sheet").waitFor({ state: "visible" })
    await page.getByTestId("item-name-input").fill(first)
    await page.getByTestId("item-form").getByRole("button", { name: tag, exact: true }).click()
    await page.getByTestId("item-add-close").click()
    await expect(page.getByTestId("item-list")).toContainText(first)

    // リストを作り、リストの中からもアイテムを（タグ付きで）追加する
    await createListFrom(page, [first])
    const listUrl = page.url()
    await page.getByTestId("fab-add-item").click()
    await page.getByTestId("tab-new").click()
    await page.locator("#item-name").fill(added)
    await page.getByTestId("bottom-sheet").getByRole("button", { name: tag, exact: true }).click()
    await page.getByRole("button", { name: "リストに追加" }).click()
    await page.getByTestId("item-selector-submit").click()
    await expect(page.getByTestId("unchecked-list")).toContainText(added)
    await expect(page.getByTestId("unchecked-list")).toContainText(first)

    // グループのメンバーにも、同じリスト・アイテム・タグが見える
    const member = await newLoggedInContext(browser, "member")
    try {
      await seedMember(member.userId)
      await openGroup(member.page, member.userId, group.id, new URL(listUrl).pathname + new URL(listUrl).search)
      await expect(member.page.getByTestId("unchecked-list")).toContainText(added, { timeout: 15000 })
      await expect(member.page.getByTestId("unchecked-list")).toContainText(first)
      await member.page.goto("/tags")
      await expect(member.page.getByTestId("tag-list")).toContainText(tag)
    } finally {
      await member.context.close()
    }
  })

  /** メンバーをグループに追加する（参加の UI は #8 で確認済みなので、ここは seed で足す） */
  async function seedMember(userId: string) {
    const { addGroupMember } = await import("./fixtures/db-helpers")
    await addGroupMember({ groupId: group.id, userId })
  }
})
