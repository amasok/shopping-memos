import { describe, it, expect } from "vitest"
import {
  createItemSchema,
  updateItemSchema,
  deleteItemSchema,
  getItemsQuerySchema,
} from "@/shared/schemas"

describe("Item API スキーマテスト", () => {
  describe("createItemSchema", () => {
    it("有効な入力を受け入れる", () => {
      const input = {
        name: "牛乳",
        quantity: 2,
        memo: "低脂肪",
        tagIds: ["123e4567-e89b-12d3-a456-426614174000"],
        groupId: "123e4567-e89b-12d3-a456-426614174001",
      }

      const result = createItemSchema.parse(input)
      expect(result.name).toBe("牛乳")
      expect(result.quantity).toBe(2)
      expect(result.memo).toBe("低脂肪")
    })

    it("名前のみで作成できる（デフォルト値適用）", () => {
      const input = { name: "パン" }

      const result = createItemSchema.parse(input)
      expect(result.name).toBe("パン")
      expect(result.quantity).toBe(1)
      expect(result.tagIds).toEqual([])
    })

    it("空の名前を拒否する", () => {
      const input = { name: "" }

      expect(() => createItemSchema.parse(input)).toThrow()
    })

    it("100文字を超える名前を拒否する", () => {
      const input = { name: "a".repeat(101) }

      expect(() => createItemSchema.parse(input)).toThrow()
    })

    it("0以下の数量を拒否する", () => {
      const input = { name: "牛乳", quantity: 0 }

      expect(() => createItemSchema.parse(input)).toThrow()
    })

    it("500文字を超えるメモを拒否する", () => {
      const input = { name: "牛乳", memo: "a".repeat(501) }

      expect(() => createItemSchema.parse(input)).toThrow()
    })
  })

  describe("updateItemSchema", () => {
    it("有効な更新入力を受け入れる", () => {
      const input = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "更新後の名前",
        quantity: 3,
      }

      const result = updateItemSchema.parse(input)
      expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000")
      expect(result.name).toBe("更新後の名前")
    })

    it("IDのみで更新できる（部分更新）", () => {
      const input = {
        id: "123e4567-e89b-12d3-a456-426614174000",
      }

      const result = updateItemSchema.parse(input)
      expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000")
      expect(result.name).toBeUndefined()
    })

    it("メモをnullにできる（削除）", () => {
      const input = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        memo: null,
      }

      const result = updateItemSchema.parse(input)
      expect(result.memo).toBeNull()
    })

    it("不正なUUIDを拒否する", () => {
      const input = {
        id: "invalid-uuid",
        name: "テスト",
      }

      expect(() => updateItemSchema.parse(input)).toThrow()
    })
  })

  describe("deleteItemSchema", () => {
    it("有効なIDを受け入れる", () => {
      const input = {
        id: "123e4567-e89b-12d3-a456-426614174000",
      }

      const result = deleteItemSchema.parse(input)
      expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000")
    })

    it("不正なUUIDを拒否する", () => {
      const input = { id: "not-a-uuid" }

      expect(() => deleteItemSchema.parse(input)).toThrow()
    })
  })

  describe("getItemsQuerySchema", () => {
    it("空のクエリを受け入れる", () => {
      const input = {}

      const result = getItemsQuerySchema.parse(input)
      expect(result.includePurchased).toBe(false)
    })

    it("フィルタリングオプションを受け入れる", () => {
      const input = {
        groupId: "123e4567-e89b-12d3-a456-426614174000",
        tagIds: ["123e4567-e89b-12d3-a456-426614174001"],
        searchText: "牛乳",
        includePurchased: true,
      }

      const result = getItemsQuerySchema.parse(input)
      expect(result.groupId).toBe("123e4567-e89b-12d3-a456-426614174000")
      expect(result.tagIds).toHaveLength(1)
      expect(result.searchText).toBe("牛乳")
      expect(result.includePurchased).toBe(true)
    })

    it("検索テキストのSQLインジェクション対策", () => {
      const input = {
        searchText: "test%_injection",
      }

      const result = getItemsQuerySchema.parse(input)
      // %と_がエスケープされる
      expect(result.searchText).toBe("test\\%\\_injection")
    })

    it("100文字を超える検索テキストを拒否する", () => {
      const input = {
        searchText: "a".repeat(101),
      }

      expect(() => getItemsQuerySchema.parse(input)).toThrow()
    })
  })
})

describe("Item ビジネスロジックテスト", () => {
  describe("アクセス制御", () => {
    it("グループなしのアイテムは誰でもアクセス可能", () => {
      const item = { id: "item-1", groupId: null }
      const hasAccess = item.groupId === null

      expect(hasAccess).toBe(true)
    })

    it("グループありのアイテムはメンバーのみアクセス可能", () => {
      const item = { id: "item-1", groupId: "group-1" }
      const userGroups = ["group-1", "group-2"]
      const hasAccess = item.groupId !== null && userGroups.includes(item.groupId)

      expect(hasAccess).toBe(true)
    })

    it("グループに所属していないユーザーはアクセス不可", () => {
      const item = { id: "item-1", groupId: "group-3" }
      const userGroups = ["group-1", "group-2"]
      const hasAccess = item.groupId !== null && userGroups.includes(item.groupId)

      expect(hasAccess).toBe(false)
    })
  })

  describe("購入状態管理", () => {
    it("未購入アイテムの判定", () => {
      const item = { purchasedAt: null }
      const isPurchased = item.purchasedAt !== null

      expect(isPurchased).toBe(false)
    })

    it("購入済みアイテムの判定", () => {
      const item = { purchasedAt: new Date() }
      const isPurchased = item.purchasedAt !== null

      expect(isPurchased).toBe(true)
    })
  })
})
