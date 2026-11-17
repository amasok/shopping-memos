// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readOtpEmail } from "../otpEmail"

describe("OTP の送信・照合の前のメールアドレスの正規化（#61 A3a 1.4）", () => {
  it("大文字や前後の空白があっても同じアドレスになる", () => {
    expect(readOtpEmail({ email: "  Taro@Example.COM " })).toBe("taro@example.com")
    expect(readOtpEmail({ email: "taro@example.com" })).toBe("taro@example.com")
  })

  it("全角の英数字は正規化して受け付ける", () => {
    expect(readOtpEmail({ email: "ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ" })).toBe("taro@example.com")
  })

  it("正規化の後も ASCII 以外が残るアドレスは受け付けない", () => {
    expect(readOtpEmail({ email: "たろう@example.com" })).toBeNull()
    expect(readOtpEmail({ email: "tаro@example.com" })).toBeNull()
  })

  it.each([undefined, null, "taro@example.com", {}, { email: 1 }, { email: "taro" }])(
    "本文にアドレスがない・形式が違う（%o）と null",
    (body) => {
      expect(readOtpEmail(body)).toBeNull()
    }
  )
})
