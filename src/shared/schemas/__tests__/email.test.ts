// @vitest-environment node
import { describe, it, expect } from "vitest"
import { EMAIL_MAX_LENGTH, emailSchema, normalizeEmail } from "../email"

describe("メールアドレスの正規化（#61 A1）", () => {
  it("前後の空白を除き、小文字にする", () => {
    expect(normalizeEmail("  Taro.Yamada@Example.COM \n")).toBe("taro.yamada@example.com")
  })

  it("全角の英数字・記号を NFKC で半角にしてから検証する", () => {
    expect(normalizeEmail("ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ")).toBe("taro@example.com")
  })

  it("サブアドレス（+）はそのまま残す", () => {
    expect(normalizeEmail("taro+shop@example.com")).toBe("taro+shop@example.com")
  })

  it("正規化の後に ASCII 以外が残るアドレス（IDN を含む）は拒否する", () => {
    expect(normalizeEmail("たろう@example.com")).toBeNull()
    expect(normalizeEmail("taro@例え.jp")).toBeNull()
    // キリル文字の а（U+0430）はラテン文字の a と見た目が同じ（ホモグリフ。#65）
    expect(normalizeEmail("tаro@example.com")).toBeNull()
  })

  it("形式が正しくないものは拒否する", () => {
    for (const input of ["", "   ", "taro", "taro@", "@example.com", "taro@example", "a b@example.com"]) {
      expect(normalizeEmail(input), input).toBeNull()
    }
  })

  it("改行を含むアドレスは拒否する（ヘッダの注入を防ぐ）", () => {
    expect(normalizeEmail("taro@example.com\nBcc: evil@example.com")).toBeNull()
  })

  it(`${EMAIL_MAX_LENGTH} 文字を超えるアドレスは拒否する`, () => {
    const local = "a".repeat(64)
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`
    const tooLong = `${local}@${domain}`
    expect(tooLong.length).toBeGreaterThan(EMAIL_MAX_LENGTH)
    expect(normalizeEmail(tooLong)).toBeNull()
  })

  it("文字列以外は拒否する", () => {
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail(123)).toBeNull()
  })

  it("emailSchema は正規化した値を返す", () => {
    expect(emailSchema.parse(" Hanako@Example.com ")).toBe("hanako@example.com")
  })

  it("emailSchema は不正なアドレスで日本語のエラーを返す", () => {
    const result = emailSchema.safeParse("hanako")
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe("メールアドレスの形式が正しくありません")
  })
})
