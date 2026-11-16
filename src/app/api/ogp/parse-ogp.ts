/**
 * OGP メタ情報の抽出。
 *
 * 正規表現の `[^>]+...[^>]+` は `>` を含まない長い入力で二乗オーダーのバックトラックを起こすため、
 * indexOf と 1 文字ずつの走査だけで実装し、入力長に対して線形時間で終わるようにしている。
 */

export interface OGPData {
  url: string
  title?: string
  description?: string
  image?: string
  siteName?: string
}

type Attributes = Map<string, string>

/** ASCII の大文字だけを小文字にする（文字列長が変わらないので元の文字列と添字を共有できる） */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

function isSpace(c: string): boolean {
  return c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f"
}

/**
 * html[start] からタグの属性を読み、`>` まで進める。
 * 閉じていないタグ（`>` や閉じ引用符が見つからない）は null を返す。
 */
function parseAttributes(
  html: string,
  lower: string,
  start: number
): { attrs: Attributes; end: number } | null {
  const attrs: Attributes = new Map()
  const n = html.length
  let i = start

  while (i < n) {
    while (i < n && (isSpace(html[i]) || html[i] === "/")) i++
    if (i >= n) return null
    if (html[i] === ">") return { attrs, end: i }

    const nameStart = i
    while (i < n && !isSpace(html[i]) && html[i] !== "=" && html[i] !== ">" && html[i] !== "/") i++
    if (i === nameStart) {
      // `=` や引用符から始まる不正な属性は 1 文字読み飛ばす
      i++
      continue
    }
    const name = lower.slice(nameStart, i)

    let j = i
    while (j < n && isSpace(html[j])) j++
    let value = ""
    if (html[j] === "=") {
      j++
      while (j < n && isSpace(html[j])) j++
      const quote = html[j]
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, j + 1)
        if (close === -1) return null
        value = html.slice(j + 1, close)
        i = close + 1
      } else {
        const valueStart = j
        while (j < n && !isSpace(html[j]) && html[j] !== ">") j++
        value = html.slice(valueStart, j)
        i = j
      }
    }

    if (!attrs.has(name)) attrs.set(name, value)
  }
  return null
}

function isTagBoundary(c: string | undefined): boolean {
  return c === undefined || isSpace(c) || c === "/" || c === ">"
}

/** `<meta ...>` タグの属性を出現順にすべて取り出す */
export function extractMetaTags(html: string): Attributes[] {
  const lower = asciiLower(html)
  const tags: Attributes[] = []
  let pos = 0

  while (pos < html.length) {
    const start = lower.indexOf("<meta", pos)
    if (start === -1) break
    const afterName = start + "<meta".length
    if (!isTagBoundary(html[afterName])) {
      pos = afterName
      continue
    }
    const parsed = parseAttributes(html, lower, afterName)
    // 閉じていないタグ以降に完結したタグは存在しないので打ち切る（走査を線形に保つ）
    if (!parsed) break
    tags.push(parsed.attrs)
    pos = parsed.end + 1
  }
  return tags
}

export function extractTitle(html: string): string | undefined {
  const lower = asciiLower(html)
  let pos = 0
  while (pos < html.length) {
    const start = lower.indexOf("<title", pos)
    if (start === -1) return undefined
    const afterName = start + "<title".length
    if (!isTagBoundary(html[afterName])) {
      pos = afterName
      continue
    }
    const gt = lower.indexOf(">", afterName)
    if (gt === -1) return undefined
    const close = lower.indexOf("</title", gt + 1)
    if (close === -1) return undefined
    const text = html.slice(gt + 1, close).trim()
    return text === "" ? undefined : text
  }
  return undefined
}

function findContent(tags: Attributes[], key: "property" | "name", value: string): string | undefined {
  for (const attrs of tags) {
    if (asciiLower(attrs.get(key) ?? "") !== value) continue
    const content = attrs.get("content")?.trim()
    if (content) return content
  }
  return undefined
}

/**
 * og:image をページの URL 基準で絶対 URL にし、http/https 以外（javascript:, data: など）は捨てる。
 * 相対パスのまま返すと、表示側で自サイトの URL として解釈されてしまう。
 */
export function resolveImageUrl(raw: string | undefined, baseUrl: string): string | undefined {
  if (!raw) return undefined
  try {
    const resolved = new URL(raw, baseUrl)
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return undefined
    return resolved.href
  } catch {
    return undefined
  }
}

/** `</head>` より前だけを対象にする（本文の巨大な HTML を解析しない） */
function headPart(html: string): string {
  const end = asciiLower(html).indexOf("</head")
  return end === -1 ? html : html.slice(0, end)
}

/**
 * @param url レスポンスに含める URL（リクエストされた URL）
 * @param baseUrl 相対 URL を解決する基準（リダイレクト後の最終 URL）。省略時は url
 */
export function parseOGP(html: string, url: string, baseUrl: string = url): OGPData | null {
  const head = headPart(html)
  const tags = extractMetaTags(head)

  // OGPタグを優先、なければ一般的なメタタグにフォールバック
  const title =
    findContent(tags, "property", "og:title") ??
    extractTitle(head) ??
    findContent(tags, "name", "title")
  const description =
    findContent(tags, "property", "og:description") ?? findContent(tags, "name", "description")
  const image = resolveImageUrl(findContent(tags, "property", "og:image"), baseUrl)
  const siteName = findContent(tags, "property", "og:site_name")

  if (!title && !description && !image && !siteName) return null

  return { url, title, description, image, siteName }
}
