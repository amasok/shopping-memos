// @vitest-environment node
import { describe, it, expect } from "vitest"
import { DISPLAY_NAME_MESSAGES, displayNameLength, displayNameSchema, updateProfileSchema } from "../profile"
import { TEXT_LIMITS } from "../limits"

function message(input: unknown): string | undefined {
  const result = displayNameSchema.safeParse(input)
  return result.success ? undefined : result.error.issues[0].message
}

describe("表示名の検証（#61 A4）", () => {
  it("前後の空白を除いた表示名を返す", () => {
    expect(displayNameSchema.parse("  たろう  ")).toBe("たろう")
  })

  it("全角の英数字は NFKC で半角にする", () => {
    expect(displayNameSchema.parse("Ｔａｒｏ")).toBe("Taro")
  })

  it("空白だけの表示名は保存できない", () => {
    expect(message("")).toBe("表示名を入力してください")
    expect(message("   ")).toBe("表示名を入力してください")
    expect(message("　")).toBe("表示名を入力してください")
  })

  it(`${TEXT_LIMITS.displayName} 文字を超える表示名は保存できない`, () => {
    expect(TEXT_LIMITS.displayName).toBe(50)
    expect(displayNameSchema.parse("あ".repeat(50))).toHaveLength(50)
    expect(message("あ".repeat(51))).toBe("表示名は 50 文字までです")
  })

  it("文字数はコードポイントで数える（絵文字 1 つが 1 文字）", () => {
    const fifty = "😀".repeat(50)
    expect(displayNameLength(fifty)).toBe(50)
    expect(displayNameSchema.parse(fifty)).toBe(fifty)
    expect(message("😀".repeat(51))).toBe("表示名は 50 文字までです")
  })

  it.each([["改行", "たろ\nう"], ["タブ", "たろ\tう"], ["C1 の制御文字", "たろ\u0085う"], ["DEL", "たろ\u007fう"], ["行の区切り U+2028", "たろ\u2028う"], ["段落の区切り U+2029", "たろ\u2029う"]])(
    "改行や制御文字（%s）を含む表示名は保存できない",
    (_label, value) => {
      expect(message(value)).toBe("使えない文字が含まれています")
    }
  )

  it.each([
    ["右から左への書式（RLO）", "‮うろた"],
    ["ゼロ幅の空白", "たろ​う"],
    ["ゼロ幅の接合子", "たろ‍う"],
    ["向きの分離（LRI）", "⁦たろう"],
    ["BOM（途中）", "たろ\ufeffう"],
  ])("向きを変える文字やゼロ幅の文字（%s）を含む表示名は保存できない", (_label, value) => {
    expect(message(value)).toBe("使えない文字が含まれています")
  })

  it("前後の BOM は空白として取り除き、残らない", () => {
    expect(displayNameSchema.parse("\ufeffたろう\ufeff")).toBe("たろう")
  })

  it("文字列以外は保存できない", () => {
    expect(displayNameSchema.safeParse(1).success).toBe(false)
    expect(displayNameSchema.safeParse(undefined).success).toBe(false)
  })

  it("保存の入力は name だけで、userId などの余計なキーは捨てる", () => {
    expect(updateProfileSchema.parse({ name: " 花子 ", userId: "other-user", image: "x" })).toEqual({ name: "花子" })
  })

  it("文言は承認済みのとおり", () => {
    expect(DISPLAY_NAME_MESSAGES).toEqual({
      required: "表示名を入力してください",
      tooLong: "表示名は 50 文字までです",
      invalidChars: "使えない文字が含まれています",
    })
  })
})
