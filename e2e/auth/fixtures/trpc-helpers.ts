import { type APIRequestContext } from "@playwright/test"
import { E2E_ORIGIN } from "../../ports"

const ORIGIN = E2E_ORIGIN
const TRPC_URL = `${ORIGIN}/api/trpc`
// same-origin 検証が入っても通るよう、ブラウザ相当の Origin を付ける
const HEADERS = { Origin: ORIGIN }

/**
 * tRPC を HTTP で直接呼び出すヘルパー（superjson の非バッチ形式）
 * ログイン済み storageState を持つ APIRequestContext で呼ぶと、そのユーザーとして実行される
 */
async function parse<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>, path: string): Promise<T> {
  const body = await res.json()
  if (!res.ok() || body?.error) {
    throw new Error(`trpc ${path} failed: ${res.status()} ${JSON.stringify(body?.error ?? body)}`)
  }
  return body.result.data.json as T
}

export async function trpcQuery<T>(request: APIRequestContext, path: string, input: unknown): Promise<T> {
  const url = `${TRPC_URL}/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
  return parse<T>(await request.get(url, { headers: HEADERS }), path)
}

export async function trpcMutation<T>(request: APIRequestContext, path: string, input: unknown): Promise<T> {
  const res = await request.post(`${TRPC_URL}/${path}`, { data: { json: input }, headers: HEADERS })
  return parse<T>(res, path)
}

/** 権限エラー等で失敗することを期待する呼び出し。HTTP ステータスを返す */
export async function trpcMutationStatus(request: APIRequestContext, path: string, input: unknown): Promise<number> {
  const res = await request.post(`${TRPC_URL}/${path}`, { data: { json: input }, headers: HEADERS })
  return res.status()
}
