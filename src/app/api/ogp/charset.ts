/**
 * OGP を取得した HTML のバイト列を、文字コードを判定してデコードする（#105）。
 *
 * 判定の順（HTML の仕様の簡略版）:
 * 1. UTF-8 の BOM
 * 2. Content-Type の charset
 * 3. 先頭の <meta charset> / <meta http-equiv="Content-Type" content="...; charset=...">
 * 4. どれもない・未知のラベルなら UTF-8
 *
 * ラベルは TextDecoder（WHATWG Encoding）に任せる。Shift_JIS・windows-31j・EUC-JP などは Node の full ICU で扱える
 */

/** <meta> を探す範囲。HTML の仕様は 1024 バイトだが、<head> の前に長いコメントなどがあるページのために少し広くする */
const META_PRESCAN_BYTES = 4096

const CHARSET_IN_VALUE = /charset\s*=\s*["']?\s*([A-Za-z0-9_:.-]+)/i

export function charsetFromContentType(contentType: string): string | null {
  return CHARSET_IN_VALUE.exec(contentType)?.[1] ?? null
}

/** タグの属性（name=value）。値の引用符は外す。属性名は小文字にする */
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s>]+)))?/g

function attributesOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const m of tag.matchAll(ATTRIBUTE)) {
    const name = m[1].toLowerCase()
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? "")
  }
  return attrs
}

/**
 * 先頭のバイト列から <meta> の charset を探す。
 * ASCII 互換の文字コードを前提に latin1 で読み、<meta ...> ごとに切り出して属性を調べる（入力長に対して線形）。
 * 値の中の「charset=」（例: http-equiv="refresh" の content）は拾わない
 */
export function charsetFromMeta(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, META_PRESCAN_BYTES)).toString("latin1")
  const lower = head.toLowerCase()
  let from = 0
  for (;;) {
    const start = lower.indexOf("<meta", from)
    if (start === -1) return null
    const end = lower.indexOf(">", start)
    const attrs = attributesOf(head.slice(start + "<meta".length, end === -1 ? head.length : end))

    const charset = attrs.get("charset")?.trim()
    if (charset) return charset
    if (attrs.get("http-equiv")?.trim().toLowerCase() === "content-type") {
      const found = charsetFromContentType(attrs.get("content") ?? "")
      if (found) return found
    }
    if (end === -1) return null
    from = end + 1
  }
}

function decoderFor(label: string | null): TextDecoder | null {
  if (!label) return null
  try {
    return new TextDecoder(label)
  } catch {
    return null
  }
}

export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (hasUtf8Bom) return new TextDecoder("utf-8").decode(bytes)

  const fromHeader = decoderFor(charsetFromContentType(contentType))
  if (fromHeader) return fromHeader.decode(bytes)

  const fromMeta = decoderFor(charsetFromMeta(bytes))
  // ASCII 互換のバイト列の中で見つけた utf-16 の指定は誤りなので、UTF-8 として読む（HTML の仕様どおり）
  if (fromMeta && !fromMeta.encoding.startsWith("utf-16")) return fromMeta.decode(bytes)

  return new TextDecoder("utf-8").decode(bytes)
}
