const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

export type TextSegment = { type: "text"; value: string } | { type: "url"; value: string }

/** テキストから最初のURLを1件取り出す */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX)
  return match ? match[0] : null
}

/** テキストをURL部分と非URL部分に分割する（リンク化用） */
export function splitByUrls(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  const regex = new RegExp(URL_REGEX.source, "g")
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: "url", value: match[0] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) })
  }

  return segments
}
