// @vitest-environment node
import { describe, expect, it } from "vitest"
import { charsetFromContentType, charsetFromMeta, decodeHtml } from "../charset"

const bytes = (s: string) => Buffer.from(s, "latin1")

describe("charsetFromContentType (#105)", () => {
  it.each([
    ["text/html; charset=Shift_JIS", "Shift_JIS"],
    ["text/html;charset=\"euc-jp\"", "euc-jp"],
    ["text/html; CHARSET = 'windows-31j'", "windows-31j"],
    ["text/html", null],
    ["text/html; charset=", null],
  ])("%j → %j", (value, expected) => {
    expect(charsetFromContentType(value)).toBe(expected)
  })
})

describe("charsetFromMeta (#105)", () => {
  it("最初に見つかった指定を返す", () => {
    expect(charsetFromMeta(bytes('<meta name="viewport" content="width=device-width"><meta charset="Shift_JIS"><meta charset="utf-8">'))).toBe("Shift_JIS")
  })

  it("http-equiv が Content-Type でない <meta> の content は見ない", () => {
    expect(charsetFromMeta(bytes('<meta http-equiv="refresh" content="0; charset=euc-jp">'))).toBeNull()
  })

  it("コメントの中の <meta> は飛ばし、その後ろの <meta> を読む", () => {
    expect(charsetFromMeta(bytes('<!-- <meta charset="Shift_JIS"> --><meta charset="euc-jp">'))).toBe("euc-jp")
    expect(charsetFromMeta(bytes('<!-- <meta charset="Shift_JIS">'))).toBeNull()
  })

  it.each([["<metadata charset=\"shift_jis\">"], ["<metal charset=shift_jis>"]])("%s は <meta> と見なさない", (tag) => {
    expect(charsetFromMeta(bytes(tag))).toBeNull()
  })

  it("<meta/charset=...> のように / で続く書き方も読む", () => {
    expect(charsetFromMeta(bytes("<meta/charset=shift_jis>"))).toBe("shift_jis")
  })

  it("閉じていない <meta> の中でも探す", () => {
    expect(charsetFromMeta(bytes('<html><head><meta charset="euc-jp"'))).toBe("euc-jp")
  })

  it("先頭 4096 バイトより後ろの <meta> は見ない", () => {
    expect(charsetFromMeta(bytes(`<!--${" ".repeat(5000)}--><meta charset="shift_jis">`))).toBeNull()
  })

  it("> のない巨大な入力でもすぐ終わる（探すのは先頭だけ）", () => {
    const start = Date.now()
    expect(charsetFromMeta(bytes(`<meta ${"a".repeat(2 * 1024 * 1024)}`))).toBeNull()
    expect(Date.now() - start).toBeLessThan(200)
  })
})

describe("decodeHtml (#105)", () => {
  it("未知のラベルは UTF-8 として読む", () => {
    expect(decodeHtml(Buffer.from("日本語"), "text/html; charset=x-unknown")).toBe("日本語")
  })
})
