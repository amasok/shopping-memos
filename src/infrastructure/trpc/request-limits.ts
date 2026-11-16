import { REQUEST_LIMITS } from "@/shared/schemas/limits"

/**
 * tRPC のリクエストの大きさの上限（#72）
 *
 * fetch アダプタには maxBodySize / バッチ件数の設定がないため、ハンドラの前で確かめる。
 * - HTTP バッチの呼び出し数（`/api/trpc/a,b,c?batch=1`）
 * - リクエストボディの大きさ（Content-Length がなくても、読みながら上限で打ち切る）
 */

type Limits = { batchSize: number; bodyBytes: number }

const DEFAULT_LIMITS: Limits = {
  batchSize: REQUEST_LIMITS.batchSize,
  bodyBytes: REQUEST_LIMITS.bodyBytes,
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status })
}

/** バッチで呼び出すプロシージャの数（パスのカンマ区切りの数。batch=1 の有無に関係なく数える） */
export function countBatchCalls(url: URL, endpoint: string): number {
  let path = url.pathname.slice(endpoint.length)
  try {
    path = decodeURIComponent(path)
  } catch {
    // 不正なエンコードはそのまま数える（tRPC 側で NOT_FOUND になる）
  }
  return path.replace(/^\/+/, "").split(",").length
}

/** 上限まで読み、超えたら null を返す */
async function readBodyWithLimit(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/**
 * 上限を超えていればエラーのレスポンスを、超えていなければ（本文を読み直せる）リクエストを返す
 */
export async function enforceRequestLimits(
  req: Request,
  endpoint: string,
  limits: Limits = DEFAULT_LIMITS
): Promise<{ request: Request } | { response: Response }> {
  const url = new URL(req.url)
  if (countBatchCalls(url, endpoint) > limits.batchSize) {
    return { response: errorResponse(400, `一度に呼び出せるのは ${limits.batchSize} 件までです`) }
  }

  if (req.method === "GET" || req.method === "HEAD") return { request: req }

  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limits.bodyBytes) {
    return { response: errorResponse(413, "リクエストが大きすぎます") }
  }

  const body = await readBodyWithLimit(req, limits.bodyBytes)
  if (body === null) {
    return { response: errorResponse(413, "リクエストが大きすぎます") }
  }

  return {
    request: new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: body as BodyInit,
      signal: req.signal,
    }),
  }
}
