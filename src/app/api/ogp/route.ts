import { lookup } from "dns/promises"
import { NextRequest, NextResponse } from "next/server"

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
]

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip))
}

interface OGPData {
  url: string
  title?: string
  description?: string
  image?: string
  siteName?: string
}

function parseMetaContent(html: string, property: string): string | undefined {
  // property="og:xxx" content="..." と content="..." property="og:xxx" の両パターンに対応
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
      "i"
    ),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return match[1]
  }
  return undefined
}

function parseMetaName(html: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return match[1]
  }
  return undefined
}

function parseTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match ? match[1].trim() : undefined
}

function isAmazonUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return /amazon\.|amzn\./.test(hostname)
  } catch {
    return false
  }
}

/** Amazon の data-a-dynamic-image から最大幅の商品画像URLを取得 */
function parseAmazonImage(html: string): string | undefined {
  const regex = /data-a-dynamic-image="(\{[^"]+\})"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const jsonStr = match[1].replace(/&quot;/g, '"')
    try {
      const images = JSON.parse(jsonStr) as Record<string, [number, number]>
      const urls = Object.keys(images)
      if (urls.length === 0) continue
      // 最大幅の画像を選択
      return urls.reduce((a, b) => (images[a][0] >= images[b][0] ? a : b))
    } catch {
      continue
    }
  }
  return undefined
}

/** microlink.io API経由でOGPデータを取得（AmazonのIP検出回避用） */
async function fetchOGPViaMicrolink(url: string): Promise<OGPData | null> {
  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}`
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    const json = (await response.json()) as {
      status: string
      data?: {
        title?: string | null
        description?: string | null
        image?: { url: string } | null
        publisher?: string | null
      }
    }
    if (json.status !== "success" || !json.data) return null
    const { title, description, image, publisher } = json.data
    if (!title && !description && !image) return null
    return {
      url,
      title: title ?? undefined,
      description: description ?? undefined,
      image: image?.url ?? undefined,
      siteName: publisher ?? undefined,
    }
  } catch {
    return null
  }
}

function parseOGP(html: string, url: string): OGPData | null {
  // OGPタグを優先、なければ一般的なメタタグにフォールバック
  const title =
    parseMetaContent(html, "og:title") ??
    parseTitle(html) ??
    parseMetaName(html, "title")
  const description =
    parseMetaContent(html, "og:description") ??
    parseMetaName(html, "description")
  const image =
    parseMetaContent(html, "og:image") ??
    (isAmazonUrl(url) ? parseAmazonImage(html) : undefined)
  const siteName = parseMetaContent(html, "og:site_name")

  if (!title && !description && !image && !siteName) return null

  return { url, title, description, image, siteName }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get("url")

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return NextResponse.json(
      { error: "Only http/https URLs are allowed" },
      { status: 400 }
    )
  }

  // SSRF対策: DNSルックアップしてIPアドレスを確認
  try {
    const resolved = await lookup(parsedUrl.hostname)
    if (isPrivateIp(resolved.address)) {
      return NextResponse.json(
        { error: "Private IP addresses are not allowed" },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json({ error: "Failed to resolve hostname" }, { status: 400 })
  }

  // AmazonはVercelのIPをブロックするためmicrolink.io経由で取得
  // 無料枠（50req/日）超過時は null が返り、OGPカードは非表示になる
  if (isAmazonUrl(url)) {
    const ogpData = await fetchOGPViaMicrolink(url)
    if (!ogpData) {
      return NextResponse.json({ error: "Failed to fetch OGP data" }, { status: 422 })
    }
    return NextResponse.json(ogpData, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" },
    })
  }

  const fetchHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
  }

  try {
    let response = await fetch(url, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(5000),
    })

    // 500/503 は一時的なエラーの可能性があるため1回リトライ
    if (!response.ok && (response.status === 500 || response.status === 503)) {
      response = await fetch(url, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(5000),
      })
    }

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 422 })
    }

    const contentType = response.headers.get("content-type") ?? ""
    // Content-Typeが明示的に非HTMLの場合のみ拒否（空の場合はHTMLとして試みる）
    if (contentType !== "" && !contentType.includes("text/html")) {
      return NextResponse.json({ error: "URL is not an HTML page" }, { status: 422 })
    }

    // ストリームを読みながらサイズを確認し、超えたら即打ち切る（DoS対策）
    const MAX_BYTES = 5 * 1024 * 1024 // 5MB
    const reader = response.body?.getReader()
    if (!reader) {
      return NextResponse.json({ error: "Failed to read response" }, { status: 422 })
    }
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalBytes += value.byteLength
      if (totalBytes > MAX_BYTES) {
        await reader.cancel()
        return NextResponse.json({ error: "Response too large" }, { status: 422 })
      }
    }
    const html = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
    )

    const ogpData = parseOGP(html, url)

    if (!ogpData) {
      return NextResponse.json({ error: "No OGP tags found" }, { status: 422 })
    }

    return NextResponse.json(ogpData, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" },
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Request timed out" }, { status: 500 })
    }
    return NextResponse.json({ error: "Failed to fetch OGP data" }, { status: 500 })
  }
}
