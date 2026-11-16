import { REQUEST_LIMITS } from "@/shared/schemas/limits"
import type { IncomingMessage } from "http"
import { NextRequest, NextResponse } from "next/server"
import { requestPinned } from "./http-client"
import { parseOGP } from "./parse-ogp"
import { getClientIp, ogpRateLimiter } from "./rate-limit"
import {
  HostResolutionError,
  PrivateAddressError,
  resolvePublicAddresses,
  validateTargetUrl,
  type UrlValidationError,
} from "./ssrf"

const MAX_REDIRECTS = 5
const TIMEOUT_MS = 8000
/** 受け付ける URL の長さ（#72） */
const MAX_URL_LENGTH = REQUEST_LIMITS.ogpUrl
// OGP は <head> にあるので先頭だけ読む（メモリ・処理時間の上限）。
// YouTube は <head> にスクリプトが大量にあり、og タグが 800KB 付近に来るため、それが入る大きさにする
const MAX_BYTES = 2 * 1024 * 1024

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
}

const URL_ERROR_MESSAGES: Record<UrlValidationError, string> = {
  invalid_protocol: "Only http/https URLs are allowed",
  invalid_port: "Only ports 80 and 443 are allowed",
  credentials_not_allowed: "URLs with credentials are not allowed",
}

class BlockedUrlError extends Error {}
class UpstreamError extends Error {}

function isAmazonUrl(url: URL): boolean {
  return /amazon\.|amzn\./.test(url.hostname)
}

function discard(res: IncomingMessage) {
  res.resume()
  res.destroy()
}

/**
 * リダイレクトを 1 ホップずつ自前で追従する。
 * 各ホップでスキーム・ポート・解決した全 IP を検証し、検証した IP に直接接続する。
 */
async function fetchWithValidation(
  initialUrl: URL,
  signal: AbortSignal
): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  let current = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const urlError = validateTargetUrl(current)
    if (urlError) throw new BlockedUrlError(URL_ERROR_MESSAGES[urlError])

    const pinned = await resolvePublicAddresses(current.hostname)
    const options = { headers: FETCH_HEADERS, signal }

    let res = await requestPinned(current, pinned, options)
    // 500/503 は一時的なエラーの可能性があるため1回リトライ（同じ検証済み IP に接続）
    if (res.statusCode === 500 || res.statusCode === 503) {
      discard(res)
      res = await requestPinned(current, pinned, options)
    }

    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400) {
      const location = res.headers.location
      discard(res)
      if (!location) throw new UpstreamError("Redirect without location")
      try {
        current = new URL(location, current)
      } catch {
        throw new UpstreamError("Invalid redirect location")
      }
      continue
    }
    return { response: res, finalUrl: current }
  }

  throw new UpstreamError("Too many redirects")
}

async function readHead(res: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of res as AsyncIterable<Buffer>) {
      const remaining = MAX_BYTES - total
      const piece = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
      chunks.push(piece)
      total += piece.byteLength
      if (total >= MAX_BYTES) break
      if (piece.includes("</head") || piece.includes("</HEAD")) break
    }
  } finally {
    res.destroy()
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * 自サイトのページからの呼び出しかを判定する（他サイトからブラウザ経由で踏み台にされるのを防ぐ）。
 * - Sec-Fetch-Site があれば same-origin / none（直接アクセス）のみ許可
 * - なければ Origin があるときは自オリジンと一致する場合のみ許可
 * - どちらも無い（ブラウザ以外のクライアント）は許可する。ヘッダーは偽装できるため、
 *   ブラウザ外からの乱用はレート制限（主に Vercel WAF）で抑える
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite !== null) return fetchSite === "same-origin" || fetchSite === "none"

  const origin = request.headers.get("origin")
  if (origin !== null) return origin === request.nextUrl.origin

  return true
}

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 })
  }

  if (!ogpRateLimiter.consume(getClientIp(request.headers))) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get("url")

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  // 長すぎる URL は解析せずに拒否する（#72）
  if (url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  const urlError = validateTargetUrl(parsedUrl)
  if (urlError) {
    return NextResponse.json({ error: URL_ERROR_MESSAGES[urlError] }, { status: 400 })
  }

  // AmazonはVercelのIPをボットとして検出するためOGP取得不可（URLリンクのみ表示）
  if (isAmazonUrl(parsedUrl)) {
    return NextResponse.json({ error: "Amazon URLs are not supported" }, { status: 422 })
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS)

  try {
    const { response, finalUrl } = await fetchWithValidation(parsedUrl, signal)

    const status = response.statusCode ?? 0
    if (status < 200 || status >= 300) {
      discard(response)
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 422 })
    }

    const contentType = response.headers["content-type"] ?? ""
    // Content-Typeが明示的に非HTMLの場合のみ拒否（空の場合はHTMLとして試みる）
    if (contentType !== "" && !contentType.includes("text/html")) {
      discard(response)
      return NextResponse.json({ error: "URL is not an HTML page" }, { status: 422 })
    }

    const html = await readHead(response)
    const ogpData = parseOGP(html, url, finalUrl.href)

    if (!ogpData) {
      return NextResponse.json({ error: "No OGP tags found" }, { status: 422 })
    }

    return NextResponse.json(ogpData, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" },
    })
  } catch (error) {
    if (error instanceof PrivateAddressError || error instanceof HostResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof BlockedUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof UpstreamError) {
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 422 })
    }
    if (signal.aborted) {
      return NextResponse.json({ error: "Request timed out" }, { status: 500 })
    }
    return NextResponse.json({ error: "Failed to fetch OGP data" }, { status: 500 })
  }
}
