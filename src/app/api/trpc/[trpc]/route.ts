import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "@/infrastructure/trpc/routers"
import { createContext } from "@/infrastructure/trpc/server"
import { enforceRequestLimits } from "@/infrastructure/trpc/request-limits"

const ENDPOINT = "/api/trpc"

/**
 * tRPC API ハンドラー
 * Next.js App Router用
 */
const handler = async (req: Request) => {
  // バッチ件数とボディの大きさの上限（#72）
  const checked = await enforceRequestLimits(req, ENDPOINT)
  if ("response" in checked) return checked.response

  return fetchRequestHandler({
    endpoint: ENDPOINT,
    req: checked.request,
    router: appRouter,
    createContext,
    // 予期しないエラーは、本番でもサーバーのログに残す（応答では汎用の文言にする。#135）。
    // 開発中は、意図して投げたエラーも含めて出す
    onError: ({ path, error }) => {
      if (error.code === "INTERNAL_SERVER_ERROR" || process.env.NODE_ENV === "development") {
        console.error(`❌ tRPC failed on ${path ?? "<no-path>"} (${error.code}): ${error.message}`, error.cause ?? "")
      }
    },
  })
}

export { handler as GET, handler as POST }
