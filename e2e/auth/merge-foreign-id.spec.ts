import { test, expect, type APIRequestContext } from "@playwright/test"
import { testUUID } from "./fixtures/db-helpers"
import { USER_B_STORAGE } from "./fixtures/auth-helpers"
import { trpcMutation, trpcQuery } from "./fixtures/trpc-helpers"

/**
 * #116: 他のユーザーが持つ ID と衝突したレコードは、「取り込み済み」ではなく「失敗」として数える（実 DB）
 *
 * 分割送信の再試行では、同じユーザーが前回取り込んだ同じ ID の INSERT 失敗を失敗に数えない（alreadyMergedCount）。
 * その判定が他人のデータには働かないこと、他人のデータは変わらないことを確かめる。
 */
test.describe("sync.merge と他のユーザーの ID の衝突 (#116)", () => {
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
  const merge = (request: APIRequestContext, data: Partial<MergeData>) =>
    trpcMutation<MergeResponse>(request, "sync.merge", { data: { ...empty, ...data } })
  const pendingCount = async (request: APIRequestContext) =>
    (await trpcQuery<{ pendingCount: number }>(request, "sync.getStatus", undefined)).pendingCount

  test("B が持つ ID のタグ・アイテム・リストを A が merge すると、失敗として数え、B のデータは変わらず、A の ID としても取り込まれない", async ({
    request,
    browser,
  }) => {
    const bContext = await browser.newContext({ storageState: USER_B_STORAGE })
    try {
      const bRequest = bContext.request
      const suffix = testUUID().slice(0, 8)
      const tagId = testUUID()
      const itemId = testUUID()
      const listId = testUUID()
      const bTagName = `Bのタグ-${suffix}`
      const bItemName = `Bのアイテム-${suffix}`

      // B が、自分のタグ・アイテム・リストを（merge で ID を指定して）作る
      const bResult = await merge(bRequest, {
        tags: [{ id: tagId, name: bTagName, createdAt: now }],
        items: [{ id: itemId, name: bItemName, quantity: 1, tagIds: [], createdAt: now }],
        lists: [{ id: listId, name: `Bのリスト-${suffix}`, status: "in_progress", createdAt: now }],
      })
      expect(bResult.mergeResult.mergedCounts).toMatchObject({ tags: 1, items: 1, lists: 1 })

      // A が、同じ ID のレコードと、正常なレコードを一緒に送る
      const newTagId = testUUID()
      const newItemId = testUUID()
      const aPendingBefore = await pendingCount(request)
      const aResult = await merge(request, {
        tags: [
          { id: tagId, name: `Aが送った同じID-${suffix}`, createdAt: now },
          { id: newTagId, name: `Aの新規タグ-${suffix}`, createdAt: now },
        ],
        items: [
          { id: itemId, name: `Aが送った同じID-${suffix}`, quantity: 1, tagIds: [], createdAt: now },
          { id: newItemId, name: `Aの新規アイテム-${suffix}`, quantity: 1, tagIds: [newTagId], createdAt: now },
        ],
        lists: [{ id: listId, name: `Aが送った同じID-${suffix}`, status: "in_progress", createdAt: now }],
      })

      // 同じ ID の 3 件は、取り込み済みではなく失敗として数える。正常な 2 件は取り込まれる
      expect(aResult.mergeResult.notImportedCount).toBe(3)
      expect(aResult.mergeResult.alreadyMergedCount).toBe(0)
      expect(aResult.mergeResult.errors).toHaveLength(3)
      expect(aResult.mergeResult.mergedCounts).toMatchObject({ tags: 1, items: 1, lists: 0 })
      // 同期ログは、A が取り込めた分（新規タグ 1 件 + 新規アイテム 1 件）だけ増える
      expect((await pendingCount(request)) - aPendingBefore).toBe(2)

      // B のデータは変わっていない
      const bTags = await trpcQuery<Array<{ id: string; name: string }>>(bRequest, "catalog.getTags", {})
      expect(bTags.find((t) => t.id === tagId)?.name).toBe(bTagName)
      const bItems = await trpcQuery<Array<{ id: string; name: string }>>(bRequest, "catalog.getItems", {
        searchText: bItemName,
        includePurchased: true,
      })
      expect(bItems.find((i) => i.id === itemId)?.name).toBe(bItemName)

      // A の側には、B の ID のレコードは現れない（A のデータとして取り込まれていない）
      const aTags = await trpcQuery<Array<{ id: string }>>(request, "catalog.getTags", {})
      expect(aTags.map((t) => t.id)).not.toContain(tagId)
      expect(aTags.map((t) => t.id)).toContain(newTagId)
    } finally {
      await bContext.close()
    }
  })

  test("同じユーザーが取り込み済みの ID は、送り直しても失敗に数えない（他のユーザーの ID との違い）", async ({ request }) => {
    const tagId = testUUID()
    const first = await merge(request, { tags: [{ id: tagId, name: `自分のタグ-${tagId.slice(0, 8)}`, createdAt: now }] })
    expect(first.mergeResult.mergedCounts.tags).toBe(1)

    const again = await merge(request, { tags: [{ id: tagId, name: `自分のタグ-${tagId.slice(0, 8)}`, createdAt: now }] })

    expect(again.mergeResult.notImportedCount).toBe(0)
    expect(again.mergeResult.alreadyMergedCount).toBe(1)
    expect(again.mergeResult.errors).toEqual([])
  })
})
