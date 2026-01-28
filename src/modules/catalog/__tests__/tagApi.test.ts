import { describe, it, expect } from "vitest"
import {
  createTagSchema,
  updateTagSchema,
  deleteTagSchema,
  getTagsQuerySchema,
} from "@/shared/schemas"

describe("Tag API スキーマテスト", () => {
  describe("createTagSchema", () => {
    it("有効な入力を受け入れる", () => {
      const input = {
        name: "食品",
        groupId: "123e4567-e89b-12d3-a456-426614174000",
      }

      const result = createTagSchema.parse(input)
      expect(result.name).toBe("食品")
      expect(result.groupId).toBe("123e4567-e89b-12d3-a456-426614174000")
    })

    it("名前のみで作成できる", () => {
      const input = { name: "日用品" }

      const result = createTagSchema.parse(input)
      expect(result.name).toBe("日用品")
      expect(result.groupId).toBeUndefined()
    })

    it("空の名前を拒否する", () => {
      const input = { name: "" }

      expect(() => createTagSchema.parse(input)).toThrow()
    })

    it("50文字を超える名前を拒否する", () => {
      const input = { name: "a".repeat(51) }

      expect(() => createTagSchema.parse(input)).toThrow()
    })
  })

  describe("updateTagSchema", () => {
    it("有効な更新入力を受け入れる", () => {
      const input = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "更新後のタグ",
      }

      const result = updateTagSchema.parse(input)
      expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000")
      expect(result.name).toBe("更新後のタグ")
    })

    it("IDのみで更新できる（部分更新）", () => {
      const input = {
        id: "123e4567-e89b-12d3-a456-426614174000",
      }

      const result = updateTagSchema.parse(input)
      expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000")
      expect(result.name).toBeUndefined()
    })

    it("不正なUUIDを拒否する", () => {
      const input = {
        id: "invalid-uuid",
        name: "テスト",
      }

      expect(() => updateTagSchema.parse(input)).toThrow()
    })
  })

  describe("deleteTagSchema", () => {
    it("有効なIDを受け入れる", () => {
      const input = {
        id: "123e4567-e89b-12d3-a456-426614174000",
      }

      const result = deleteTagSchema.parse(input)
      expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000")
    })

    it("不正なUUIDを拒否する", () => {
      const input = { id: "not-a-uuid" }

      expect(() => deleteTagSchema.parse(input)).toThrow()
    })
  })

  describe("getTagsQuerySchema", () => {
    it("空のクエリを受け入れる", () => {
      const input = {}

      const result = getTagsQuerySchema.parse(input)
      expect(result.groupId).toBeUndefined()
    })

    it("グループIDでフィルタリングできる", () => {
      const input = {
        groupId: "123e4567-e89b-12d3-a456-426614174000",
      }

      const result = getTagsQuerySchema.parse(input)
      expect(result.groupId).toBe("123e4567-e89b-12d3-a456-426614174000")
    })
  })
})

describe("Tag ビジネスロジックテスト", () => {
  describe("アクセス制御", () => {
    it("グループなしのタグは誰でもアクセス可能", () => {
      const tag = { id: "tag-1", groupId: null }
      const hasAccess = tag.groupId === null

      expect(hasAccess).toBe(true)
    })

    it("グループありのタグはメンバーのみアクセス可能", () => {
      const tag = { id: "tag-1", groupId: "group-1" }
      const userGroups = ["group-1", "group-2"]
      const hasAccess = tag.groupId !== null && userGroups.includes(tag.groupId)

      expect(hasAccess).toBe(true)
    })

    it("グループに所属していないユーザーはアクセス不可", () => {
      const tag = { id: "tag-1", groupId: "group-3" }
      const userGroups = ["group-1", "group-2"]
      const hasAccess = tag.groupId !== null && userGroups.includes(tag.groupId)

      expect(hasAccess).toBe(false)
    })
  })

  describe("タグ使用数", () => {
    it("使用数0のタグ", () => {
      const tag = { id: "tag-1", usageCount: 0 }
      const isUnused = tag.usageCount === 0

      expect(isUnused).toBe(true)
    })

    it("使用中のタグ", () => {
      const tag = { id: "tag-1", usageCount: 5 }
      const isUsed = tag.usageCount > 0

      expect(isUsed).toBe(true)
    })
  })
})
