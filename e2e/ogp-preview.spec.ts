import { test, expect } from "@playwright/test"
import { setupCleanPage, seedTable, waitForBottomSheet } from "./fixtures/test-helpers"
import { createItem, createListItem, createList, resetIdCounter } from "./fixtures/test-data"

const MOCK_OGP = {
  url: "https://example.com",
  title: "Example Domain",
  description: "This is an example page.",
  image: "https://example.com/og.png",
  siteName: "Example",
}

/** /api/ogp をモックして成功レスポンスを返す */
async function mockOGPSuccess(page: import("@playwright/test").Page) {
  await page.route("**/api/ogp**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_OGP),
    })
  })
}

/** /api/ogp をモックして失敗レスポンスを返す */
async function mockOGPFailure(page: import("@playwright/test").Page) {
  await page.route("**/api/ogp**", (route) => {
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "No OGP tags found" }),
    })
  })
}

test.describe("OGPプレビュー", () => {
  test.beforeEach(async ({ page }) => {
    resetIdCounter()
    await setupCleanPage(page, "/")
  })

  test("L-1: URLを含むメモのアイテムにOGPプレビューカードが表示される", async ({ page }) => {
    await mockOGPSuccess(page)

    const item = createItem({ name: "参考商品", memo: "https://example.com" })
    await seedTable(page, "items", [item])
    await page.reload()

    // OGPプレビューカードが表示される
    const card = page.locator("[data-testid='ogp-preview']")
    await expect(card).toBeVisible()

    // タイトルと説明が表示される
    await expect(card).toContainText("Example Domain")
    await expect(card).toContainText("This is an example page.")
  })

  test("L-2: メモ内のURLがリンクとして表示される", async ({ page }) => {
    await mockOGPSuccess(page)

    const item = createItem({ name: "リンク付き商品", memo: "参考: https://example.com" })
    await seedTable(page, "items", [item])
    await page.reload()

    // URLがaタグとして表示される
    const link = page.locator(`a[href='https://example.com']`).first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("target", "_blank")
  })

  test("L-3: URLを含まないメモにはOGPプレビューが表示されない", async ({ page }) => {
    const item = createItem({ name: "普通の商品", memo: "低脂肪タイプ" })
    await seedTable(page, "items", [item])
    await page.reload()

    await expect(page.locator("[data-testid='ogp-preview']")).not.toBeVisible()
  })

  test("L-4: OGP取得失敗時はカードが表示されずURLリンクのみ表示される", async ({ page }) => {
    await mockOGPFailure(page)

    const item = createItem({ name: "商品", memo: "https://example.com" })
    await seedTable(page, "items", [item])
    await page.reload()

    // OGPカードは表示されない
    await expect(page.locator("[data-testid='ogp-preview']")).not.toBeVisible()

    // URLリンクは表示される
    const link = page.locator(`a[href='https://example.com']`).first()
    await expect(link).toBeVisible()
  })

  test("L-5: ItemFormでURL入力中にOGPプレビューが表示される", async ({ page }) => {
    await mockOGPSuccess(page)

    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)

    // メモにURLを入力
    await page.locator("[data-testid='item-memo-input']").fill("https://example.com")

    // OGPプレビューカードが表示される
    const card = page.locator("[data-testid='ogp-preview']")
    await expect(card).toBeVisible()
    await expect(card).toContainText("Example Domain")
  })

  test("L-6: 買い物リストのチェック済みアイテムのOGPプレビューにopacityが適用される", async ({ page }) => {
    await mockOGPSuccess(page)

    const list = createList({ name: "テストリスト" })
    const listItem = createListItem({
      listId: list.id,
      name: "チェック済み商品",
      memo: "https://example.com",
      checked: true,
    })
    await seedTable(page, "lists", [list])
    await seedTable(page, "listItems", [listItem])

    await page.goto(`/lists/detail?id=${list.id}`)

    // OGPプレビューカードが表示される
    const card = page.locator("[data-testid='ogp-preview']")
    await expect(card).toBeVisible()

    // opacity-50クラスが適用されている
    await expect(card).toHaveClass(/opacity-50/)
  })

  test("L-7: 複数URLがあるメモは最初の1件のみプレビュー表示される", async ({ page }) => {
    // reload 前のページからのリクエストも捕捉されるため、回数ではなく対象URLで検証する
    const requestedUrls = new Set<string>()
    await page.route("**/api/ogp**", (route) => {
      requestedUrls.add(new URL(route.request().url()).searchParams.get("url") ?? "")
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...MOCK_OGP, url: route.request().url() }),
      })
    })

    const item = createItem({
      name: "マルチURL商品",
      memo: "https://first.com と https://second.com",
    })
    await seedTable(page, "items", [item])
    await page.reload()

    // OGPカードは1件のみ表示される
    await expect(page.locator("[data-testid='ogp-preview']")).toHaveCount(1)

    // 最初のURLに対してのみAPIが呼ばれる
    await page.waitForTimeout(500)
    expect([...requestedUrls]).toEqual(["https://first.com"])
  })

  test("L-8: ItemFormでOGP取得に失敗したときはドメインとURLだけのカードが表示される（#140）", async ({ page }) => {
    await mockOGPFailure(page)

    await page.locator("[data-testid='fab-add-item']").click()
    await waitForBottomSheet(page)

    await page.locator("[data-testid='item-memo-input']").fill("https://example.com/item/1")

    const fallback = page.locator("[data-testid='ogp-link-fallback']")
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText("example.com")
    await expect(fallback).toHaveAttribute("href", "https://example.com/item/1")
    await expect(page.locator("[data-testid='ogp-preview']")).not.toBeVisible()
  })

  test("L-9: ホームでOGP取得に失敗したときはリンクだけのカードも表示されない（#140）", async ({ page }) => {
    await mockOGPFailure(page)

    const item = createItem({ name: "商品", memo: "https://example.com" })
    await seedTable(page, "items", [item])
    const ogpResponse = page.waitForResponse("**/api/ogp**")
    await page.reload()
    await ogpResponse

    await expect(page.locator(`a[href='https://example.com']`).first()).toBeVisible()
    // 失敗の応答を受けてスケルトンが消えたあとも、リンクだけのカードは出ない
    await expect(page.locator(".animate-pulse")).toHaveCount(0)
    await expect(page.locator("[data-testid='ogp-link-fallback']")).toHaveCount(0)
  })

  test("L-10: 画像ファイルのURLは、ホームでも画像付きのカードとして表示される（#140）", async ({ page }) => {
    const imageUrl = "https://example.com/uploads/photo.jpg"
    await page.route("**/api/ogp**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: imageUrl, image: imageUrl, title: "photo.jpg" }),
      })
    )
    // 外部の画像は読みに行かず、1x1 の PNG を返す
    await page.route(imageUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
          "base64"
        ),
      })
    )

    const item = createItem({ name: "写真", memo: imageUrl })
    await seedTable(page, "items", [item])
    await page.reload()

    const card = page.locator("[data-testid='ogp-preview']")
    await expect(card).toBeVisible()
    await expect(card).toContainText("photo.jpg")
    await expect(card.locator("img")).toHaveAttribute("src", imageUrl)
  })
})
