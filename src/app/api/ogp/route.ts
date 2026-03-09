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

function parseOGP(html: string, url: string): OGPData | null {
  // OGPタグを優先、なければ一般的なメタタグにフォールバック
  const title =
    parseMetaContent(html, "og:title") ??
    parseMetaName(html, "title") ??
    parseTitle(html)
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

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ShoppingMemoBot/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 422 })
    }

    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ error: "URL is not an HTML page" }, { status: 422 })
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Response too large" }, { status: 422 })
    }

    const html = new TextDecoder().decode(arrayBuffer)
    const ogpData = parseOGP(html, url)

    if (!ogpData) {
      return NextResponse.json({ error: "No OGP tags found" }, { status: 422 })
    }

    return NextResponse.json(ogpData, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=3600" },
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Request timed out" }, { status: 500 })
    }
    return NextResponse.json({ error: "Failed to fetch OGP data" }, { status: 500 })
  }
}
