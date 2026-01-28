import { describe, it, expect } from "vitest"
import { createItemSchema, updateItemSchema, getItemsQuerySchema } from "../item"

describe("createItemSchema", () => {
  it("有効な入力を受け入れる", () => {
    const input = {
      name: "牛乳",
      quantity: 2,
      memo: "低脂肪",
      tagIds: ["550e8400-e29b-41d4-a716-446655440000"],
      groupId: "550e8400-e29b-41d4-a716-446655440001",
    }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("牛乳")
      expect(result.data.quantity).toBe(2)
    }
  })

  it("デフォルト値が適用される", () => {
    const input = { name: "牛乳" }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quantity).toBe(1)
      expect(result.data.tagIds).toEqual([])
    }
  })

  it("空の名前を拒否する", () => {
    const input = { name: "" }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("100文字を超える名前を拒否する", () => {
    const input = { name: "a".repeat(101) }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("0以下の数量を拒否する", () => {
    const input = { name: "牛乳", quantity: 0 }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("負の数量を拒否する", () => {
    const input = { name: "牛乳", quantity: -1 }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("小数の数量を拒否する", () => {
    const input = { name: "牛乳", quantity: 1.5 }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("500文字を超えるメモを拒否する", () => {
    const input = { name: "牛乳", memo: "a".repeat(501) }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("無効なUUID形式のtagIdを拒否する", () => {
    const input = { name: "牛乳", tagIds: ["invalid-uuid"] }

    const result = createItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("updateItemSchema", () => {
  it("有効な更新を受け入れる", () => {
    const input = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "低脂肪牛乳",
    }

    const result = updateItemSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("IDのみでも有効", () => {
    const input = {
      id: "550e8400-e29b-41d4-a716-446655440000",
    }

    const result = updateItemSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("IDが必須", () => {
    const input = { name: "牛乳" }

    const result = updateItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("getItemsQuerySchema", () => {
  it("空のクエリを受け入れる", () => {
    const input = {}

    const result = getItemsQuerySchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.includePurchased).toBe(false)
    }
  })

  it("検索テキストのLIKE特殊文字をエスケープする", () => {
    const input = { searchText: "100%" }

    const result = getItemsQuerySchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.searchText).toBe("100\\%")
    }
  })

  it("検索テキストのアンダースコアをエスケープする", () => {
    const input = { searchText: "test_item" }

    const result = getItemsQuerySchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.searchText).toBe("test\\_item")
    }
  })
})
