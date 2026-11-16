import { describe, it, expect } from "vitest"
import { MERGE_LIMITS, REQUEST_LIMITS, TEXT_LIMITS, boundedRecordSchema } from "../limits"
import { createItemSchema, getItemsQuerySchema, updateItemSchema } from "../item"
import { addNewItemToListSchema, createListSchema } from "../list"
import { acceptInviteSchema } from "../group"
import {
  syncMergeInputSchema,
  syncPullInputSchema,
  syncPushInputSchema,
  syncQueueItemSchema,
} from "../sync"

/** n 件の UUID */
const uuids = (n: number) =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)

const operation = (payload: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  entity: "item",
  entityId: crypto.randomUUID(),
  operation: "update",
  payload,
  createdAt: new Date(),
})

const emptyMerge = { items: [], tags: [], lists: [], listItems: [], history: [] }

describe("入力の上限（#72）", () => {
  describe("tagIds", () => {
    it("API のタグ数の上限は merge と同じ値", () => {
      expect(REQUEST_LIMITS.tagIds).toBe(MERGE_LIMITS.tagIdsPerEntity)
    })

    it("上限ちょうどの件数は受け付ける", () => {
      expect(createItemSchema.safeParse({ name: "牛乳", tagIds: uuids(REQUEST_LIMITS.tagIds) }).success).toBe(true)
    })

    it.each([
      ["createItem", (tagIds: string[]) => createItemSchema.safeParse({ name: "牛乳", tagIds })],
      ["updateItem", (tagIds: string[]) => updateItemSchema.safeParse({ id: uuids(1)[0], tagIds })],
      ["getItems", (tagIds: string[]) => getItemsQuerySchema.safeParse({ tagIds })],
      ["createList", (tagIds: string[]) => createListSchema.safeParse({ name: "L", tagIds })],
      ["addNewItemToList", (tagIds: string[]) =>
        addNewItemToListSchema.safeParse({ listId: uuids(1)[0], name: "牛乳", tagIds })],
    ])("%s は上限を超えるタグを拒否する", (_, parse) => {
      expect(parse(uuids(REQUEST_LIMITS.tagIds + 1)).success).toBe(false)
    })
  })

  describe("itemIds", () => {
    it("createList は上限までのアイテムを受け付け、超えたら拒否する", () => {
      expect(createListSchema.safeParse({ name: "L", itemIds: uuids(REQUEST_LIMITS.itemIds) }).success).toBe(true)
      expect(createListSchema.safeParse({ name: "L", itemIds: uuids(REQUEST_LIMITS.itemIds + 1) }).success).toBe(false)
    })
  })

  describe("quantity", () => {
    it("上限（9999）までは受け付ける", () => {
      expect(TEXT_LIMITS.quantityMax).toBe(9999)
      expect(createItemSchema.safeParse({ name: "牛乳", quantity: 9999 }).success).toBe(true)
    })

    it.each([
      ["createItem", (q: number) => createItemSchema.safeParse({ name: "牛乳", quantity: q })],
      ["updateItem", (q: number) => updateItemSchema.safeParse({ id: uuids(1)[0], quantity: q })],
      ["addNewItemToList", (q: number) =>
        addNewItemToListSchema.safeParse({ listId: uuids(1)[0], name: "牛乳", quantity: q })],
    ])("%s は 9999 を超える数量・DB の integer を超える数量を拒否する", (_, parse) => {
      expect(parse(10000).success).toBe(false)
      expect(parse(2 ** 31).success).toBe(false)
    })

    it("0 以下は従来どおり拒否する", () => {
      expect(createItemSchema.safeParse({ name: "牛乳", quantity: 0 }).success).toBe(false)
    })
  })

  describe("招待トークン", () => {
    it("長すぎるトークンを拒否する", () => {
      expect(acceptInviteSchema.safeParse({ token: "a".repeat(REQUEST_LIMITS.inviteToken) }).success).toBe(true)
      expect(acceptInviteSchema.safeParse({ token: "a".repeat(REQUEST_LIMITS.inviteToken + 1) }).success).toBe(false)
    })
  })

  describe("レコードの大きさ", () => {
    it("JSON で 8KB までのレコードは受け付ける", () => {
      expect(boundedRecordSchema.safeParse({ memo: "a".repeat(8000) }).success).toBe(true)
    })

    it("JSON で 8KB を超えるレコードを拒否する", () => {
      expect(boundedRecordSchema.safeParse({ memo: "a".repeat(REQUEST_LIMITS.recordBytes) }).success).toBe(false)
    })

    it("マルチバイト文字は UTF-8 のバイト数で数える", () => {
      // 3 バイト × 3000 文字 = 9000 バイト
      expect(boundedRecordSchema.safeParse({ memo: "あ".repeat(3000) }).success).toBe(false)
    })
  })

  describe("sync.push", () => {
    it("100 件までの操作は受け付ける", () => {
      const operations = Array.from({ length: REQUEST_LIMITS.pushOperations }, () => operation())
      expect(syncPushInputSchema.safeParse({ operations }).success).toBe(true)
    })

    it("100 件を超える操作を拒否する", () => {
      const operations = Array.from({ length: REQUEST_LIMITS.pushOperations + 1 }, () => operation())
      expect(syncPushInputSchema.safeParse({ operations }).success).toBe(false)
    })

    it("8KB を超えるパッチを拒否する", () => {
      const operations = [operation({ memo: "a".repeat(REQUEST_LIMITS.recordBytes) })]
      expect(syncPushInputSchema.safeParse({ operations }).success).toBe(false)
    })

    it("同期キューのパッチも 8KB までに制限する", () => {
      const item = { ...operation({ memo: "a".repeat(REQUEST_LIMITS.recordBytes) }), retryCount: 0 }
      expect(syncQueueItemSchema.safeParse(item).success).toBe(false)
    })
  })

  describe("sync.pull", () => {
    it("上限を超えるグループ数を拒否する", () => {
      expect(syncPullInputSchema.safeParse({ groupIds: uuids(REQUEST_LIMITS.groupIds) }).success).toBe(true)
      expect(syncPullInputSchema.safeParse({ groupIds: uuids(REQUEST_LIMITS.groupIds + 1) }).success).toBe(false)
    })
  })

  describe("sync.merge", () => {
    const counts = Object.entries(MERGE_LIMITS).filter(([key]) => key !== "tagIdsPerEntity")

    it.each(counts)("%s は %i 件までに制限する", (key, max) => {
      const ok = { data: { ...emptyMerge, [key]: Array.from({ length: max }, () => ({})) } }
      const ng = { data: { ...emptyMerge, [key]: Array.from({ length: max + 1 }, () => ({})) } }
      expect(syncMergeInputSchema.safeParse(ok).success).toBe(true)
      expect(syncMergeInputSchema.safeParse(ng).success).toBe(false)
    })
  })
})
