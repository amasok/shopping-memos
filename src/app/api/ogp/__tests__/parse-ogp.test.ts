import { describe, it, expect } from "vitest"
import { parseOGP, extractMetaTags, extractTitle, resolveImageUrl } from "../parse-ogp"

const URL_ = "https://example.com/"

describe("parseOGP: 属性の書き方", () => {
  it("property と content の順序が逆でも抽出できる", () => {
    const html = `<meta content="タイトル" property="og:title"><meta content="説明" property="og:description">`

    expect(parseOGP(html, URL_)).toMatchObject({ title: "タイトル", description: "説明" })
  })

  it("タグ名・属性名・property の値が大文字でも抽出できる", () => {
    const html = `<META PROPERTY="OG:TITLE" CONTENT="大文字">`

    expect(parseOGP(html, URL_)?.title).toBe("大文字")
  })

  it("単一引用符の値を抽出できる", () => {
    const html = `<meta property='og:title' content='単一引用符'>`

    expect(parseOGP(html, URL_)?.title).toBe("単一引用符")
  })

  it("引用符なしの値を抽出できる", () => {
    const html = `<meta property=og:title content=quoteless>`

    expect(parseOGP(html, URL_)?.title).toBe("quoteless")
  })

  it("値に > を含んでいても途中で切れない", () => {
    const html = `<meta property="og:title" content="A > B">`

    expect(parseOGP(html, URL_)?.title).toBe("A > B")
  })

  it("自己閉じ（/>）のタグを抽出できる", () => {
    const html = `<meta property="og:title" content="自己閉じ" />`

    expect(parseOGP(html, URL_)?.title).toBe("自己閉じ")
  })

  it("改行や複数の空白を挟んだ属性も抽出できる", () => {
    const html = `<meta\n  property="og:title"\n\tcontent="改行"\n>`

    expect(parseOGP(html, URL_)?.title).toBe("改行")
  })

  it("<metadata> のような meta で始まる別タグは meta として扱わない", () => {
    const html = `<metadata property="og:title" content="偽"><meta property="og:description" content="本物">`

    const result = parseOGP(html, URL_)
    expect(result?.title).toBeUndefined()
    expect(result?.description).toBe("本物")
  })

  it("同じ属性が重複していたら最初の値を使う", () => {
    const html = `<meta property="og:title" content="最初" content="後">`

    expect(parseOGP(html, URL_)?.title).toBe("最初")
  })
})

describe("parseOGP: フォールバックと範囲", () => {
  it("og:title がなければ title タグ、さらに name=title の順にフォールバックする", () => {
    expect(parseOGP(`<title> ページ名 </title>`, URL_)?.title).toBe("ページ名")
    expect(parseOGP(`<meta name="title" content="メタタイトル">`, URL_)?.title).toBe("メタタイトル")
  })

  it("og:description がなければ name=description を使う", () => {
    expect(parseOGP(`<meta name="description" content="通常の説明">`, URL_)?.description).toBe("通常の説明")
  })

  it("og:image と og:site_name を抽出する", () => {
    const html = `<meta property="og:image" content="https://example.com/a.png"><meta property="og:site_name" content="サイト">`

    expect(parseOGP(html, URL_)).toMatchObject({ image: "https://example.com/a.png", siteName: "サイト" })
  })

  it("</head> より後ろのメタタグは無視する", () => {
    const html = `<head><title>ヘッド</title></head><body><meta property="og:title" content="本文内"></body>`

    expect(parseOGP(html, URL_)?.title).toBe("ヘッド")
  })

  it("メタ情報がなければ null", () => {
    expect(parseOGP(`<html><body>なし</body></html>`, URL_)).toBeNull()
  })

  it("content が空白だけのタグは無視する", () => {
    expect(parseOGP(`<meta property="og:title" content="   ">`, URL_)).toBeNull()
  })

  it("返り値の url は引数のURLをそのまま返す", () => {
    expect(parseOGP(`<title>a</title>`, "https://x.test/p?q=1")?.url).toBe("https://x.test/p?q=1")
  })

  it("閉じていないタグより後の完結したタグは読まない", () => {
    const tags = extractMetaTags(`<meta property="og:title" content="未完結 <meta property="og:description" content="後">`)

    expect(tags.map((t) => t.get("property"))).not.toContain("og:description")
  })

  it("title の閉じタグがなければ undefined", () => {
    expect(extractTitle(`<title>閉じていない`)).toBeUndefined()
  })
})

describe("parseOGP: 計算量（ReDoS 対策）", () => {
  const LIMIT_MS = 500

  const time = (fn: () => void): number => {
    const start = performance.now()
    fn()
    return performance.now() - start
  }

  it("<meta の後に > が続かない数百 KB の入力でもすぐ返る", () => {
    const html = "<meta " + "a".repeat(600_000)

    expect(time(() => parseOGP(html, URL_))).toBeLessThan(LIMIT_MS)
  })

  it("<meta を大量に繰り返し、どれも > で閉じない入力でもすぐ返る", () => {
    const html = "<meta ".repeat(100_000)

    expect(time(() => parseOGP(html, URL_))).toBeLessThan(LIMIT_MS)
  })

  it("閉じ引用符のない属性が続く入力でもすぐ返る", () => {
    const html = `<meta property="og:title" content="` + "x".repeat(600_000)

    expect(time(() => parseOGP(html, URL_))).toBeLessThan(LIMIT_MS)
  })

  it("<title の閉じタグがない巨大な入力でもすぐ返る", () => {
    const html = "<title>" + "<title>".repeat(80_000)

    expect(time(() => parseOGP(html, URL_))).toBeLessThan(LIMIT_MS)
  })

  it("空白と = だけが続く病的な属性でもすぐ返る", () => {
    const html = "<meta " + " = ".repeat(200_000)

    expect(time(() => parseOGP(html, URL_))).toBeLessThan(LIMIT_MS)
  })

  it("完結した meta が大量にある入力も線形時間で処理できる", () => {
    const html = `<meta name="x" content="y">`.repeat(20_000) + `<meta property="og:title" content="末尾">`

    expect(parseOGP(html, URL_)?.title).toBe("末尾")
  })
})

describe("resolveImageUrl (#66)", () => {
  const base = "https://example.com/dir/page"

  it.each([
    ["/img.png", "https://example.com/img.png"],
    ["img.png", "https://example.com/dir/img.png"],
    ["../up.png", "https://example.com/up.png"],
    ["//cdn.example/x.png", "https://cdn.example/x.png"],
    ["https://other.example/a.png?x=1", "https://other.example/a.png?x=1"],
  ])("%s を絶対URLにする", (raw, expected) => {
    expect(resolveImageUrl(raw, base)).toBe(expected)
  })

  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:image/png;base64,AAAA"],
    ["file:///etc/passwd"],
    ["ftp://example.com/a.png"],
    ["blob:https://example.com/uuid"],
    // http の画像は混在コンテンツになるので捨てる（#73-4）
    ["http://other.example/a.png"],
  ])("%s は捨てる", (raw) => {
    expect(resolveImageUrl(raw, base)).toBeUndefined()
  })

  it("ページが http でも、相対パスの画像は http になるので捨てる (#73-4)", () => {
    expect(resolveImageUrl("/img.png", "http://example.com/page")).toBeUndefined()
  })

  it("空・未指定は undefined", () => {
    expect(resolveImageUrl(undefined, base)).toBeUndefined()
    expect(resolveImageUrl("", base)).toBeUndefined()
  })

  it("基準URLが不正で相対パスを解決できなければ undefined", () => {
    expect(resolveImageUrl("/img.png", "not a url")).toBeUndefined()
  })

  it("基準URLが不正なら、絶対URLでも安全側に倒して返さない", () => {
    expect(resolveImageUrl("https://example.com/a.png", "not a url")).toBeUndefined()
  })
})

describe("parseOGP: og:image の解決 (#66)", () => {
  it("相対パスの og:image は baseUrl（最終URL）基準で絶対URLにする", () => {
    const html = `<meta property="og:title" content="t"><meta property="og:image" content="/a.png">`

    const result = parseOGP(html, "https://start.example/x", "https://final.example/y")

    expect(result?.image).toBe("https://final.example/a.png")
    expect(result?.url).toBe("https://start.example/x")
  })

  it("baseUrl を省略すると url を基準にする", () => {
    const html = `<meta property="og:title" content="t"><meta property="og:image" content="a.png">`

    expect(parseOGP(html, "https://example.com/dir/p")?.image).toBe("https://example.com/dir/a.png")
  })

  it("javascript: / data: の og:image は返さず、他の情報は返す", () => {
    const html = `<meta property="og:title" content="t"><meta property="og:image" content="javascript:alert(1)">`

    expect(parseOGP(html, URL_)).toMatchObject({ title: "t", image: undefined })
  })

  it("og:image が不正で他の情報もなければ null", () => {
    expect(parseOGP(`<meta property="og:image" content="data:image/png;base64,AAAA">`, URL_)).toBeNull()
  })
})
