import { test, expect } from "@playwright/test"
import { testUUID } from "./fixtures/db-helpers"
import { trpcMutation, trpcQuery } from "./fixtures/trpc-helpers"

/**
 * #90: sync.merge で 1 件が失敗（ID 重複）しても、PostgreSQL のトランザクションが
 * aborted にならず、ほかのデータはマージされる（実 DB）
 */
test.describe("sync.merge の一部失敗 (#90)", () => {
  type MergeResult = {
    mergeResult: {
      success: boolean
      mergedCounts: Record<string, number>
      notImportedCount: number
      alreadyMergedCount: number
      errors: string[]
    }
  }
  const now = new Date().toISOString()
  const emptyData = { items: [], tags: [], lists: [], listItems: [], history: [] }

  test("重複 ID のタグが 1 件あっても、ほかのタグとアイテムはマージされる", async ({ request }) => {
    const dupTagId = testUUID()
    const first = await trpcMutation<MergeResult>(request, "sync.merge", {
      data: { ...emptyData, tags: [{ id: dupTagId, name: "重複タグ", createdAt: now }] },
    })
    expect(first.mergeResult.mergedCounts.tags).toBe(1)

    const pendingCount = async () =>
      (await trpcQuery<{ pendingCount: number }>(request, "sync.getStatus", undefined)).pendingCount
    const pendingBefore = await pendingCount()

    const newTagId = testUUID()
    const itemId = testUUID()
    const second = await trpcMutation<MergeResult>(request, "sync.merge", {
      data: {
        ...emptyData,
        tags: [
          { id: dupTagId, name: "重複タグ", createdAt: now },
          { id: newTagId, name: "新規タグ", createdAt: now },
        ],
        items: [
          { id: itemId, name: "マージされるアイテム", quantity: 1, tagIds: [newTagId], createdAt: now },
        ],
      },
    })

    expect(second.mergeResult.mergedCounts.tags).toBe(1)
    expect(second.mergeResult.mergedCounts.items).toBe(1)
    // 重複タグの INSERT は DB で失敗するが（SAVEPOINT でその分だけ戻る）、同じユーザーが前回取り込んだ
    // 同じ ID なので、#116 からは失敗ではなく取り込み済みとして数える（分割送信の再試行で件数が増えないように）
    expect(second.mergeResult.alreadyMergedCount).toBe(1)
    expect(second.mergeResult.notImportedCount).toBe(0)
    expect(second.mergeResult.errors).toEqual([])
    // 同期ログは成功した分（新規タグ 1 件 + アイテム 1 件）だけ増え、失敗した重複タグの分は残らない
    expect((await pendingCount()) - pendingBefore).toBe(2)
    expect(second.mergeResult.errors.join()).not.toContain("マージ処理に失敗しました")
  })
})
