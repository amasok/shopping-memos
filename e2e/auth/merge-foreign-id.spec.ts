import { test, expect, type APIRequestContext } from "@playwright/test"
import { testUUID } from "./fixtures/db-helpers"
import { USER_B_STORAGE } from "./fixtures/auth-helpers"
import { trpcMutation, trpcQuery } from "./fixtures/trpc-helpers"

/**
 * #116: 他のユーザーが持つ ID と衝突したレコードは、「取り込み済み」として数えない（実 DB）
 *
 * 分割送信の再試行では、同じユーザーが前回取り込んだ同じ ID の INSERT 失敗を失敗に数えない（alreadyMergedCount）。
 * その判定が他人のデータには働かないこと、他人のデータは変わらないことを確かめる。
 * アイテム・リストは失敗として数える。タグは、同じブラウザで別のアカウントが先に取り込んだ初期タグで起きるため、
 * 失敗にせず、新しい ID（または同じ名前の自分のタグ）に付け替える
 */
test.describe("sync.merge と他のユーザーの ID の衝突 (#116)", () => {
  type MergeResponse = {
    idMappings: Array<{ entity: string; localId: string; serverId: string }>
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

  test("B が持つ ID のタグ・アイテム・リストを A が merge すると、アイテム・リストは失敗、タグは新しい ID で取り込み、B のデータは変わらない", async ({
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

      // 同じ ID のアイテムとリストは、取り込み済みではなく失敗として数える
      expect(aResult.mergeResult.notImportedCount).toBe(2)
      expect(aResult.mergeResult.alreadyMergedCount).toBe(0)
      expect(aResult.mergeResult.errors).toHaveLength(2)
      // 同じ ID のタグは失敗にせず、A の新しい ID で作る（同じブラウザで別のアカウントが先に取り込んだ場合）
      expect(aResult.mergeResult.mergedCounts).toMatchObject({ tags: 2, items: 1, lists: 0 })
      expect(aResult.idMappings).toHaveLength(1)
      expect(aResult.idMappings[0]).toMatchObject({ entity: "tag", localId: tagId })
      const remappedTagId = aResult.idMappings[0].serverId
      expect(remappedTagId).not.toBe(tagId)
      // 同期ログは、A が取り込めた分（付け替えたタグ 1 件 + 新規タグ 1 件 + 新規アイテム 1 件）だけ増える
      expect((await pendingCount(request)) - aPendingBefore).toBe(3)

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
      expect(aTags.map((t) => t.id)).toContain(remappedTagId)
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
