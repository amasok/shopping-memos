import { test, expect } from "@playwright/test"
import { testUUID } from "./fixtures/db-helpers"
import { trpcMutation, trpcMutationStatus, trpcQuery } from "./fixtures/trpc-helpers"

/**
 * #116: ゲストデータの sync.merge の分割送信（実 DB）
 *
 * クライアント（DataMergeContext）は、参照される側から順に（タグ → アイテム → リスト → リストアイテム → 履歴）
 * 複数のリクエストに分けて送る。そのときのサーバー側の動作を、実 DB で確かめる。
 */
test.describe("sync.merge の分割送信 (#116)", () => {
  // 同期ログ（pendingCount）の増加分を数えるので、このファイルの中は順番に実行する
  test.describe.configure({ mode: "serial" })
  type MergeResponse = {
    mergeResult: {
      mergedCounts: Record<string, number>
      notImportedCount: number
      alreadyMergedCount: number
      errors: string[]
    }
  }
  const now = new Date().toISOString()
  type MergeData = Record<"tags" | "items" | "lists" | "listItems" | "history", unknown[]>
  const empty: MergeData = { tags: [], items: [], lists: [], listItems: [], history: [] }
  const merge = (request: Parameters<typeof trpcMutation>[0], data: Partial<MergeData>) =>
    trpcMutation<MergeResponse>(request, "sync.merge", { data: { ...empty, ...data } })
  const pendingCount = async (request: Parameters<typeof trpcMutation>[0]) =>
    (await trpcQuery<{ pendingCount: number }>(request, "sync.getStatus", undefined)).pendingCount

  /** 3 つのリクエストに分けたデータ。2 つ目・3 つ目は、前のリクエストで取り込んだタグ・リストを参照する */
  function chunks() {
    const tagId = testUUID()
    const itemId = testUUID()
    const listId = testUUID()
    const itemName = `分割アイテム-${itemId.slice(0, 8)}`
    return {
      tagId,
      itemId,
      listId,
      itemName,
      first: {
        // タグは同じ名前の自分のタグにまとめるので、テストごとに名前を変える
        tags: [{ id: tagId, name: `分割タグ-${tagId.slice(0, 8)}`, createdAt: now }],
        items: [{ id: itemId, name: itemName, quantity: 1, tagIds: [tagId], createdAt: now }],
      },
      second: {
        lists: [{ id: listId, name: "分割リスト", status: "in_progress" as const, createdAt: now }],
        listItems: [
          { id: testUUID(), listId, name: "リストアイテムA", quantity: 1, tagIds: [], checked: false, createdAt: now },
        ],
      },
      third: {
        // リストは前のリクエストで取り込み済み
        listItems: [
          { id: testUUID(), listId, name: "リストアイテムB", quantity: 2, tagIds: [], checked: true, createdAt: now },
        ],
        history: [{ id: testUUID(), listId, purchasedAt: now }],
      },
    }
  }

  test("参照先が前のリクエストにあっても、順に送れば全件取り込まれ、同期ログは取り込んだ分だけ増える", async ({ request }) => {
    const c = chunks()
    const pendingBefore = await pendingCount(request)

    const r1 = await merge(request, c.first)
    const r2 = await merge(request, c.second)
    const r3 = await merge(request, c.third)

    expect(r1.mergeResult.mergedCounts).toMatchObject({ tags: 1, items: 1 })
    expect(r2.mergeResult.mergedCounts).toMatchObject({ lists: 1, listItems: 1 })
    expect(r3.mergeResult.mergedCounts).toMatchObject({ listItems: 1, history: 1 })
    for (const r of [r1, r2, r3]) {
      expect(r.mergeResult.notImportedCount).toBe(0)
      expect(r.mergeResult.errors).toEqual([])
    }

    // 前のリクエストのリストにも、後のリクエストのリストアイテムが付いている
    const listItems = await trpcQuery<Array<{ name: string }>>(request, "shopping.getListItems", { listId: c.listId })
    expect(listItems.map((i) => i.name).sort()).toEqual(["リストアイテムA", "リストアイテムB"])
    const items = await trpcQuery<Array<{ id: string }>>(request, "catalog.getItems", {
      searchText: c.itemName,
      includePurchased: true,
    })
    expect(items.map((i) => i.id)).toContain(c.itemId)

    // 同期ログ: タグ 1 + アイテム 1 + リスト 1 + リストアイテム 2 + 履歴 1
    expect((await pendingCount(request)) - pendingBefore).toBe(6)
  })

  test("途中で失敗した再試行を想定して同じ分割を送り直しても、重複せず、取り込めなかった件数は増えない", async ({ request }) => {
    const c = chunks()
    await merge(request, c.first)
    await merge(request, c.second)
    await merge(request, c.third)
    const pendingAfterFirstRun = await pendingCount(request)

    // 最初から送り直す（DataMergeContext の再試行）
    const again = [await merge(request, c.first), await merge(request, c.second), await merge(request, c.third)]

    for (const r of again) {
      expect(r.mergeResult.notImportedCount).toBe(0)
    }
    // 取り込み済みのレコードとして数える（失敗ではない）: tags 1 + items 1 / lists 1 + listItems 1 / listItems 1
    expect(again.map((r) => r.mergeResult.alreadyMergedCount)).toEqual([2, 2, 1])
    // リストアイテムは重複しない
    const listItems = await trpcQuery<Array<{ name: string }>>(request, "shopping.getListItems", { listId: c.listId })
    expect(listItems).toHaveLength(2)
    // 失敗した分の同期ログは残らない。履歴は UPDATE なので、送り直した分だけ増える（1 件）
    expect((await pendingCount(request)) - pendingAfterFirstRun).toBe(1)
  })

  test("件数の上限（items 1000）を超える 1 リクエストは BAD_REQUEST になる（分割して送る必要がある）", async ({ request }) => {
    const items = Array.from({ length: 1001 }, (_, i) => ({
      id: testUUID(),
      name: `上限確認${i}`,
      quantity: 1,
      tagIds: [],
      createdAt: now,
    }))

    const status = await trpcMutationStatus(request, "sync.merge", { data: { ...empty, items } })

    expect(status).toBe(400)
  })

  test("上限ちょうどの件数（items 1000）は 1 リクエストで取り込める", async ({ request }) => {
    test.setTimeout(90_000)
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: testUUID(),
      name: `上限ちょうど${i}`,
      quantity: 1,
      tagIds: [],
      createdAt: now,
    }))

    const res = await merge(request, { items })

    expect(res.mergeResult.mergedCounts.items).toBe(1000)
    expect(res.mergeResult.notImportedCount).toBe(0)
  })

  test("sync.merge 単独のボディが 4MB を超えると 413 になる", async ({ request }) => {
    const pad = "x".repeat(4 * 1024 * 1024 + 1024)

    const status = await trpcMutationStatus(request, "sync.merge", { data: { ...empty }, pad })

    expect(status).toBe(413)
  })
})
