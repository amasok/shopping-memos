import { describe, it, expect } from "vitest"
import { extractFirstUrl, splitByUrls } from "../url"

describe("extractFirstUrl", () => {
  it("URLを含むテキストから最初のURLを取り出す", () => {
    expect(extractFirstUrl("参考: https://example.com")).toBe("https://example.com")
  })

  it("複数URLがある場合は最初の1件のみ返す", () => {
    expect(extractFirstUrl("https://first.com と https://second.com")).toBe(
      "https://first.com"
    )
  })

  it("URLがない場合はnullを返す", () => {
    expect(extractFirstUrl("URLなしのテキスト")).toBeNull()
  })

  it("空文字の場合はnullを返す", () => {
    expect(extractFirstUrl("")).toBeNull()
  })

  it("httpのURLも対応する", () => {
    expect(extractFirstUrl("http://example.com")).toBe("http://example.com")
  })

  it("日本語テキストとURLが混在しても正しく取り出す", () => {
    expect(extractFirstUrl("牛乳 https://store.example.com/milk 低脂肪")).toBe(
      "https://store.example.com/milk"
    )
  })
})

describe("splitByUrls", () => {
  it("URLを含むテキストをtext/urlセグメントに分割する", () => {
    const result = splitByUrls("参考: https://example.com をチェック")
    expect(result).toEqual([
      { type: "text", value: "参考: " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: " をチェック" },
    ])
  })

  it("URLのみのテキストはurlセグメント1件を返す", () => {
    const result = splitByUrls("https://example.com")
    expect(result).toEqual([{ type: "url", value: "https://example.com" }])
  })

  it("URLがないテキストはtextセグメント1件を返す", () => {
    const result = splitByUrls("URLなしのメモ")
    expect(result).toEqual([{ type: "text", value: "URLなしのメモ" }])
  })

  it("複数URLがあるテキストを正しく分割する", () => {
    const result = splitByUrls("https://first.com と https://second.com")
    expect(result).toEqual([
      { type: "url", value: "https://first.com" },
      { type: "text", value: " と " },
      { type: "url", value: "https://second.com" },
    ])
  })

  it("空文字は空配列を返す", () => {
    const result = splitByUrls("")
    expect(result).toEqual([])
  })
})
