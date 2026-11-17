import { describe, it, expect } from "vitest"
import {
  createListSchema,
  checkItemSchema,
  finishShoppingSchema,
  listStatusSchema,
  addItemToListSchema,
  addNewItemToListSchema,
} from "../list"

describe("createListSchema", () => {
  it("有効な入力を受け入れる", () => {
    const input = {
      name: "週末の買い物",
      tagIds: ["550e8400-e29b-41d4-a716-446655440000"],
      groupId: "550e8400-e29b-41d4-a716-446655440001",
    }

    const result = createListSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("週末の買い物")
    }
  })

  it("名前のみでも有効", () => {
    const input = { name: "買い物" }

    const result = createListSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("空の名前を拒否する", () => {
    const input = { name: "" }

    const result = createListSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("100文字を超える名前を拒否する", () => {
    const input = { name: "a".repeat(101) }

    const result = createListSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("checkItemSchema", () => {
  it("有効な入力を受け入れる", () => {
    const input = {
      listItemId: "550e8400-e29b-41d4-a716-446655440000",
      checked: true,
    }

    const result = checkItemSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("checkedがfalseでも有効", () => {
    const input = {
      listItemId: "550e8400-e29b-41d4-a716-446655440000",
      checked: false,
    }

    const result = checkItemSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("checkedが必須", () => {
    const input = {
      listItemId: "550e8400-e29b-41d4-a716-446655440000",
    }

    const result = checkItemSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("finishShoppingSchema", () => {
  it("有効な入力を受け入れる", () => {
    const input = {
      listId: "550e8400-e29b-41d4-a716-446655440000",
      location: "イオン",
    }

    const result = finishShoppingSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("locationなしでも有効", () => {
    const input = {
      listId: "550e8400-e29b-41d4-a716-446655440000",
    }

    const result = finishShoppingSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("100文字を超える場所を拒否する", () => {
    const input = {
      listId: "550e8400-e29b-41d4-a716-446655440000",
      location: "a".repeat(101),
    }

    const result = finishShoppingSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("listStatusSchema", () => {
  it("in_progressを受け入れる", () => {
    const result = listStatusSchema.safeParse("in_progress")

    expect(result.success).toBe(true)
  })

  it("completedを受け入れる", () => {
    const result = listStatusSchema.safeParse("completed")

    expect(result.success).toBe(true)
  })

  it("無効なステータスを拒否する", () => {
    const result = listStatusSchema.safeParse("cancelled")

    expect(result.success).toBe(false)
  })
})

describe("作成時のクライアント ID（#62 O3b）", () => {
  const id = "550e8400-e29b-41d4-a716-446655440009"
  const listId = "550e8400-e29b-41d4-a716-446655440001"

  it("createListSchema は uuid の id を受け付け、uuid でない id はバリデーションエラーにする", () => {
    expect(createListSchema.parse({ name: "週末", id }).id).toBe(id)
    expect(createListSchema.safeParse({ name: "週末", id: "x" }).success).toBe(false)
  })

  it("addItemToListSchema / addNewItemToListSchema はリストのアイテムの id を受け付ける", () => {
    const itemId = "550e8400-e29b-41d4-a716-446655440002"
    expect(addItemToListSchema.parse({ id, listId, itemId }).id).toBe(id)
    expect(addNewItemToListSchema.parse({ id, listId, name: "卵" }).id).toBe(id)
    expect(addNewItemToListSchema.safeParse({ id: "x", listId, name: "卵" }).success).toBe(false)
  })
})
