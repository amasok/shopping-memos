import { describe, it, expect } from "vitest"
import { createTagSchema, updateTagSchema, deleteTagSchema } from "../tag"

describe("createTagSchema", () => {
  it("有効な入力を受け入れる", () => {
    const input = {
      name: "食料品",
      groupId: "550e8400-e29b-41d4-a716-446655440000",
    }

    const result = createTagSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("食料品")
    }
  })

  it("groupIdなしでも有効", () => {
    const input = { name: "食料品" }

    const result = createTagSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("空の名前を拒否する", () => {
    const input = { name: "" }

    const result = createTagSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("50文字を超える名前を拒否する", () => {
    const input = { name: "a".repeat(51) }

    const result = createTagSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  it("50文字ちょうどの名前を受け入れる", () => {
    const input = { name: "a".repeat(50) }

    const result = createTagSchema.safeParse(input)

    expect(result.success).toBe(true)
  })
})

describe("updateTagSchema", () => {
  it("有効な更新を受け入れる", () => {
    const input = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "日用品",
    }

    const result = updateTagSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("IDが必須", () => {
    const input = { name: "日用品" }

    const result = updateTagSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})

describe("deleteTagSchema", () => {
  it("有効なUUIDを受け入れる", () => {
    const input = { id: "550e8400-e29b-41d4-a716-446655440000" }

    const result = deleteTagSchema.safeParse(input)

    expect(result.success).toBe(true)
  })

  it("無効なUUIDを拒否する", () => {
    const input = { id: "not-a-uuid" }

    const result = deleteTagSchema.safeParse(input)

    expect(result.success).toBe(false)
  })
})
